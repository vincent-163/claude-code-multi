package com.claudecode.app.ui.chat

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.claudecode.app.data.model.ChatMessage
import com.claudecode.app.network.ApiClient
import com.claudecode.app.network.SseClient
import com.claudecode.app.network.SseEvent
import com.google.gson.Gson
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

class ChatViewModel(
    private val apiClient: ApiClient,
    val sessionId: String
) : ViewModel() {

    private var sseClient: SseClient? = null

    private val _messages = MutableStateFlow<List<ChatMessage>>(emptyList())
    val messages: StateFlow<List<ChatMessage>> = _messages.asStateFlow()

    private val _sessionStatus = MutableStateFlow("connecting")
    val sessionStatus: StateFlow<String> = _sessionStatus.asStateFlow()

    private val _isConnected = MutableStateFlow(false)
    val isConnected: StateFlow<Boolean> = _isConnected.asStateFlow()

    private val _modelName = MutableStateFlow<String?>(null)
    val modelName: StateFlow<String?> = _modelName.asStateFlow()

    private val _totalCost = MutableStateFlow(0.0)
    val totalCost: StateFlow<Double> = _totalCost.asStateFlow()

    private var lastEventId: Long? = null
    private var sseJob: Job? = null

    // Track locally-sent user messages for dedup
    private val localUserMessages = mutableSetOf<String>()

    // Track in-flight control responses (user pressed button, waiting for server echo)
    private val _pendingControlResponses = MutableStateFlow<Set<String>>(emptySet())
    val pendingControlResponses: StateFlow<Set<String>> = _pendingControlResponses.asStateFlow()

    init {
        loadHistoryAndConnect()
    }

    private fun loadHistoryAndConnect() {
        viewModelScope.launch {
            apiClient.getSession(sessionId).fold(
                onSuccess = { detail ->
                    _sessionStatus.value = detail.status ?: "unknown"
                    // Parse history events and populate messages
                    val historyMessages = mutableListOf<ChatMessage>()
                    for (historyEvent in detail.rawHistory) {
                        val eventType = historyEvent.get("event")?.asString ?: continue
                        val eventId = historyEvent.get("id")?.asLong
                        val data = historyEvent.get("data")?.asJsonObject ?: continue

                        val sseEvent = if (eventType == "message") {
                            val type = data.get("type")?.asString ?: continue
                            SseClient.parseMessageEvent(type, data, eventId)
                        } else {
                            SseClient.parseEvent(eventType, Gson().toJson(data), eventId)
                        }

                        if (sseEvent != null) {
                            eventId?.let { lastEventId = it }
                            processEventToMessages(sseEvent, historyMessages)
                        }
                    }
                    if (historyMessages.isNotEmpty()) {
                        _messages.value = historyMessages
                    }
                },
                onFailure = { /* proceed anyway */ }
            )
            connectSse()
        }
    }

    private fun processEventToMessages(event: SseEvent, messages: MutableList<ChatMessage>) {
        when (event) {
            is SseEvent.SystemInit -> {
                _modelName.value = event.model
                messages.add(
                    ChatMessage.SystemMessage(
                        subtype = event.subtype,
                        sessionId = event.sessionId,
                        model = event.model,
                        tools = event.tools
                    )
                )
            }
            is SseEvent.AssistantMessage -> {
                messages.add(
                    ChatMessage.AssistantMessage(
                        content = event.content,
                        isStreaming = false
                    )
                )
            }
            is SseEvent.Result -> {
                event.totalCostUsd?.let { _totalCost.value = it }
                if (event.resultText.isNotBlank()) {
                    messages.add(
                        ChatMessage.ResultMessage(
                            resultText = event.resultText,
                            totalCostUsd = event.totalCostUsd
                        )
                    )
                }
            }
            is SseEvent.UserMessage -> {
                if (!event.isToolResult) {
                    // Regular user message from history - deduplicate
                    val content = event.content
                    if (!localUserMessages.contains(content)) {
                        messages.add(ChatMessage.UserMessage(content = content))
                    }
                }
                // Tool results are tool output - skip
            }
            is SseEvent.ControlRequest -> {
                messages.add(
                    ChatMessage.ControlRequest(
                        requestId = event.requestId,
                        toolName = event.toolName,
                        toolInput = event.toolInput,
                        blockedPath = event.blockedPath
                    )
                )
            }
            is SseEvent.ControlResponse -> {
                // Update matching ControlRequest message with approval status
                for (i in messages.indices) {
                    val msg = messages[i]
                    if (msg is ChatMessage.ControlRequest && msg.requestId == event.requestId) {
                        messages[i] = msg.copy(approved = event.approved)
                        break
                    }
                }
                _pendingControlResponses.value = _pendingControlResponses.value - event.requestId
            }
            is SseEvent.Status -> {
                _sessionStatus.value = event.status
            }
            is SseEvent.Exit -> {
                messages.add(ChatMessage.ExitMessage(exitCode = event.code))
                _sessionStatus.value = "exited"
            }
            is SseEvent.Error -> {
                messages.add(ChatMessage.ErrorMessage(content = event.message))
            }
            else -> { /* Connected, Disconnected, Ping */ }
        }
    }

    private fun connectSse() {
        sseJob?.cancel()
        sseClient?.disconnect()
        sseClient = apiClient.getSseClient()

        sseJob = viewModelScope.launch {
            val url = apiClient.getStreamUrl(sessionId)
            sseClient!!.connect(url, lastEventId).collect { event ->
                when (event) {
                    is SseEvent.Connected -> {
                        _isConnected.value = true
                        if (_sessionStatus.value == "connecting") {
                            _sessionStatus.value = "connected"
                        }
                    }

                    is SseEvent.Disconnected -> {
                        _isConnected.value = false
                        _sessionStatus.value = "disconnected"
                    }

                    is SseEvent.Ping -> { /* keepalive */ }

                    else -> {
                        when (event) {
                            is SseEvent.SystemInit -> event.eventId?.let { lastEventId = it }
                            is SseEvent.AssistantMessage -> event.eventId?.let { lastEventId = it }
                            is SseEvent.Result -> event.eventId?.let { lastEventId = it }
                            is SseEvent.UserMessage -> event.eventId?.let { lastEventId = it }
                            is SseEvent.Status -> event.eventId?.let { lastEventId = it }
                            is SseEvent.Exit -> event.eventId?.let { lastEventId = it }
                            is SseEvent.Error -> event.eventId?.let { lastEventId = it }
                            is SseEvent.ControlResponse -> event.eventId?.let { lastEventId = it }
                            else -> {}
                        }
                        val newMessages = _messages.value.toMutableList()
                        processEventToMessages(event, newMessages)
                        _messages.value = newMessages
                    }
                }
            }
        }
    }

    private fun addMessage(message: ChatMessage) {
        _messages.value = _messages.value + message
    }

    fun sendMessage(content: String) {
        if (content.isBlank()) return
        localUserMessages.add(content)
        addMessage(ChatMessage.UserMessage(content = content))
        viewModelScope.launch {
            apiClient.sendInput(sessionId, "user_message", content).fold(
                onSuccess = { /* sent */ },
                onFailure = { e ->
                    addMessage(ChatMessage.ErrorMessage(content = "Failed to send: ${e.message}"))
                }
            )
        }
    }

    fun approveControlRequest(requestId: String, toolInput: Map<String, Any>) {
        _pendingControlResponses.value = _pendingControlResponses.value + requestId
        viewModelScope.launch {
            apiClient.sendControlResponse(sessionId, requestId, approved = true, toolInput = toolInput).fold(
                onSuccess = { /* sent, will be confirmed via SSE echo */ },
                onFailure = { e ->
                    _pendingControlResponses.value = _pendingControlResponses.value - requestId
                    addMessage(ChatMessage.ErrorMessage(content = "Failed to approve: ${e.message}"))
                }
            )
        }
    }

    fun denyControlRequest(requestId: String) {
        _pendingControlResponses.value = _pendingControlResponses.value + requestId
        viewModelScope.launch {
            apiClient.sendControlResponse(sessionId, requestId, approved = false).fold(
                onSuccess = { /* sent, will be confirmed via SSE echo */ },
                onFailure = { e ->
                    _pendingControlResponses.value = _pendingControlResponses.value - requestId
                    addMessage(ChatMessage.ErrorMessage(content = "Failed to deny: ${e.message}"))
                }
            )
        }
    }

    fun sendToolResult(response: String) {
        viewModelScope.launch {
            apiClient.sendInput(sessionId, "tool_result", response)
        }
    }

    fun sendInterrupt() {
        viewModelScope.launch {
            apiClient.sendInput(sessionId, "interrupt").fold(
                onSuccess = { /* sent */ },
                onFailure = { e ->
                    addMessage(ChatMessage.ErrorMessage(content = "Failed to interrupt: ${e.message}"))
                }
            )
        }
    }

    fun reconnect() {
        _messages.value = emptyList()
        localUserMessages.clear()
        _pendingControlResponses.value = emptySet()
        loadHistoryAndConnect()
    }

    override fun onCleared() {
        super.onCleared()
        sseJob?.cancel()
        sseClient?.disconnect()
    }
}

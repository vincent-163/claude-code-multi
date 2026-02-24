package com.claudecode.app.network

import com.claudecode.app.data.model.AskUserQuestionItem
import com.claudecode.app.data.model.AskUserQuestionOption
import com.claudecode.app.data.model.ContentBlock
import com.google.gson.Gson
import com.google.gson.JsonArray
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.BufferedReader
import java.io.InputStreamReader

class SseClient(
    private val client: OkHttpClient,
    private val authToken: String?
) {
    @Volatile
    private var shouldStop = false

    fun connect(url: String, lastEventId: Long? = null): Flow<SseEvent> = callbackFlow {
        shouldStop = false

        withContext(Dispatchers.IO) {
            try {
                val requestBuilder = Request.Builder().url(
                    if (lastEventId != null) "$url?last_event_id=$lastEventId" else url
                )
                requestBuilder.addHeader("Accept", "text/event-stream")
                requestBuilder.addHeader("Cache-Control", "no-cache")
                authToken?.let {
                    requestBuilder.addHeader("Authorization", "Bearer $it")
                }

                val response = client.newCall(requestBuilder.build()).execute()

                if (!response.isSuccessful) {
                    trySend(SseEvent.Error("HTTP ${response.code}: ${response.message}"))
                    close()
                    return@withContext
                }

                trySend(SseEvent.Connected)

                val reader = BufferedReader(
                    InputStreamReader(response.body?.byteStream() ?: run {
                        trySend(SseEvent.Error("Empty response body"))
                        close()
                        return@withContext
                    })
                )

                var eventType = ""
                var eventId = ""
                val dataBuffer = StringBuilder()

                reader.use { br ->
                    while (isActive && !shouldStop) {
                        val line = br.readLine() ?: break

                        when {
                            line.startsWith("event:") -> {
                                eventType = line.removePrefix("event:").trim()
                            }
                            line.startsWith("id:") -> {
                                eventId = line.removePrefix("id:").trim()
                            }
                            line.startsWith("data:") -> {
                                if (dataBuffer.isNotEmpty()) dataBuffer.append("\n")
                                dataBuffer.append(line.removePrefix("data:").trim())
                            }
                            line.isEmpty() && dataBuffer.isNotEmpty() -> {
                                // End of event — dispatch
                                val data = dataBuffer.toString()
                                dataBuffer.clear()
                                val id = eventId.toLongOrNull()

                                if (eventType == "message") {
                                    // May produce multiple events (e.g. assistant + AskUserQuestion)
                                    try {
                                        val json = JsonParser.parseString(data).asJsonObject
                                        val type = json.get("type")?.asString
                                        if (type != null) {
                                            val events = parseMessageEvents(type, json, id)
                                            for (evt in events) {
                                                trySend(evt)
                                            }
                                        }
                                    } catch (e: Exception) {
                                        trySend(SseEvent.Error("Failed to parse event: ${e.message}"))
                                    }
                                } else {
                                    val event = parseEvent(eventType, data, id)
                                    if (event != null) {
                                        trySend(event)
                                    }
                                }

                                eventType = ""
                                eventId = ""
                            }
                        }
                    }
                }

                trySend(SseEvent.Disconnected("Stream ended"))
            } catch (e: Exception) {
                if (!shouldStop) {
                    trySend(SseEvent.Error(e.message ?: "SSE connection error"))
                }
            }
        }

        awaitClose {
            disconnect()
        }
    }

    fun disconnect() {
        shouldStop = true
    }

    companion object {
        private val gson = Gson()

        fun parseEvent(eventType: String, data: String, eventId: Long?): SseEvent? {
            return try {
                when (eventType) {
                    "message" -> {
                        val json = JsonParser.parseString(data).asJsonObject
                        val type = json.get("type")?.asString ?: return null
                        parseMessageEvent(type, json, eventId)
                    }
                    "status" -> {
                        val json = JsonParser.parseString(data).asJsonObject
                        val status = json.get("status")?.asString ?: ""
                        SseEvent.Status(status = status, eventId = eventId)
                    }
                    "exit" -> {
                        val json = JsonParser.parseString(data).asJsonObject
                        val code = json.get("code")?.asInt ?: -1
                        SseEvent.Exit(code = code, eventId = eventId)
                    }
                    "error" -> {
                        val json = JsonParser.parseString(data).asJsonObject
                        val message = json.get("message")?.asString ?: "Unknown error"
                        SseEvent.Error(message = message, eventId = eventId)
                    }
                    "ping" -> SseEvent.Ping
                    else -> null
                }
            } catch (e: Exception) {
                SseEvent.Error("Failed to parse event: ${e.message}")
            }
        }

        fun parseMessageEvent(type: String, json: JsonObject, eventId: Long?): SseEvent? {
            return when (type) {
                "system" -> {
                    val subtype = json.get("subtype")?.asString ?: ""
                    val sessionId = json.get("session_id")?.asString
                    val model = json.get("model")?.asString
                    val tools = json.getAsJsonArray("tools")?.map { it.asString }
                    SseEvent.SystemInit(
                        subtype = subtype,
                        sessionId = sessionId,
                        model = model,
                        tools = tools,
                        eventId = eventId
                    )
                }
                "assistant" -> {
                    val message = json.getAsJsonObject("message")
                    val contentBlocks = parseContentBlocks(message)
                    SseEvent.AssistantMessage(
                        content = contentBlocks,
                        eventId = eventId
                    )
                }
                "result" -> {
                    val resultText = json.get("result")?.asString ?: ""
                    val totalCost = json.get("total_cost_usd")?.asDouble
                    SseEvent.Result(
                        resultText = resultText,
                        totalCostUsd = totalCost,
                        eventId = eventId
                    )
                }
                "control_request" -> {
                    val requestId = json.get("request_id")?.asString ?: return null
                    val request = json.getAsJsonObject("request") ?: return null
                    val subtype = request.get("subtype")?.asString ?: return null
                    if (subtype == "can_use_tool") {
                        val toolName = request.get("tool_name")?.asString ?: ""
                        val input = request.get("input")?.let {
                            gson.fromJson(it.toString(), Map::class.java) as? Map<String, Any>
                        } ?: emptyMap()
                        val blockedPath = request.get("blocked_path")?.asString
                        SseEvent.ControlRequest(
                            requestId = requestId,
                            toolName = toolName,
                            toolInput = input,
                            blockedPath = blockedPath,
                            eventId = eventId
                        )
                    } else null
                }
                "control_response" -> {
                    val response = json.getAsJsonObject("response") ?: return null
                    val requestId = response.get("request_id")?.asString ?: return null
                    val innerResponse = response.getAsJsonObject("response") ?: return null
                    val behavior = innerResponse.get("behavior")?.asString ?: return null
                    SseEvent.ControlResponse(
                        requestId = requestId,
                        approved = behavior == "allow",
                        eventId = eventId
                    )
                }
                "user" -> {
                    val message = json.getAsJsonObject("message")
                    if (message != null) {
                        val contentElement = message.get("content")
                        val contentArray = if (contentElement != null && contentElement.isJsonArray) contentElement.asJsonArray else null
                        if (contentArray != null && contentArray.size() > 0) {
                            val firstBlock = contentArray[0].asJsonObject
                            val blockType = firstBlock.get("type")?.asString
                            if (blockType == "tool_result") {
                                val toolUseId = firstBlock.get("tool_use_id")?.asString ?: ""
                                val contentElement = firstBlock.get("content")
                                val content = when {
                                    contentElement == null || contentElement.isJsonNull -> ""
                                    contentElement.isJsonPrimitive -> contentElement.asString
                                    contentElement.isJsonArray -> {
                                        contentElement.asJsonArray.mapNotNull { el ->
                                            if (el.isJsonObject && el.asJsonObject.get("type")?.asString == "text")
                                                el.asJsonObject.get("text")?.asString
                                            else null
                                        }.joinToString("\n")
                                    }
                                    else -> contentElement.toString()
                                }
                                val isError = firstBlock.get("is_error")?.asBoolean ?: false
                                SseEvent.UserMessage(
                                    toolUseId = toolUseId,
                                    content = content,
                                    isError = isError,
                                    isToolResult = true,
                                    eventId = eventId
                                )
                            } else {
                                // Regular user text message
                                val textParts = contentArray.mapNotNull { el ->
                                    val obj = el.asJsonObject
                                    if (obj.get("type")?.asString == "text") obj.get("text")?.asString else null
                                }
                                if (textParts.isNotEmpty()) {
                                    SseEvent.UserMessage(
                                        content = textParts.joinToString("\n"),
                                        isToolResult = false,
                                        eventId = eventId
                                    )
                                } else null
                            }
                        } else {
                            // content might be a plain string
                            val content = message.get("content")?.asString
                            if (content != null) {
                                SseEvent.UserMessage(
                                    content = content,
                                    isToolResult = false,
                                    eventId = eventId
                                )
                            } else null
                        }
                    } else null
                }
                else -> null
            }
        }

        /**
         * Parse a message event into potentially multiple SseEvents.
         * An assistant message with AskUserQuestion tool_use blocks will produce
         * both an AssistantMessage and one or more AskUserQuestion events.
         */
        fun parseMessageEvents(type: String, json: JsonObject, eventId: Long?): List<SseEvent> {
            val primary = parseMessageEvent(type, json, eventId) ?: return emptyList()
            if (type != "assistant") return listOf(primary)

            // Check for AskUserQuestion tool_use blocks in assistant message
            val message = json.getAsJsonObject("message") ?: return listOf(primary)
            val contentArray = message.getAsJsonArray("content") ?: return listOf(primary)

            val results = mutableListOf<SseEvent>(primary)
            for (element in contentArray) {
                val block = element.asJsonObject
                val blockType = block.get("type")?.asString
                val blockName = block.get("name")?.asString
                if (blockType == "tool_use" && blockName == "AskUserQuestion") {
                    val toolUseId = block.get("id")?.asString ?: continue
                    val input = block.getAsJsonObject("input") ?: continue
                    val questions = parseAskUserQuestions(input)
                    if (questions.isNotEmpty()) {
                        results.add(SseEvent.AskUserQuestion(
                            toolUseId = toolUseId,
                            questions = questions,
                            eventId = eventId
                        ))
                    }
                } else if (blockType == "tool_use" && blockName == "ExitPlanMode") {
                    val toolUseId = block.get("id")?.asString ?: continue
                    val input = block.getAsJsonObject("input")?.let {
                        gson.fromJson(it.toString(), Map::class.java) as? Map<String, Any>
                    } ?: emptyMap()
                    results.add(SseEvent.PlanModeExit(
                        toolUseId = toolUseId,
                        input = input,
                        eventId = eventId
                    ))
                }
            }
            return results
        }

        private fun parseAskUserQuestions(input: JsonObject): List<AskUserQuestionItem> {
            val questionsArray = input.getAsJsonArray("questions") ?: return emptyList()
            return questionsArray.mapNotNull { element ->
                val q = element.asJsonObject
                val question = q.get("question")?.asString ?: return@mapNotNull null
                val header = q.get("header")?.asString ?: ""
                val multiSelect = q.get("multiSelect")?.asBoolean ?: false
                val options = q.getAsJsonArray("options")?.map { optEl ->
                    val opt = optEl.asJsonObject
                    AskUserQuestionOption(
                        label = opt.get("label")?.asString ?: "",
                        description = opt.get("description")?.asString ?: ""
                    )
                } ?: emptyList()
                AskUserQuestionItem(
                    question = question,
                    header = header,
                    options = options,
                    multiSelect = multiSelect
                )
            }
        }

        fun parseContentBlocks(message: JsonObject?): List<ContentBlock> {
            if (message == null) return emptyList()

            val contentArray: JsonArray? = when {
                message.has("content") && message.get("content").isJsonArray -> {
                    message.getAsJsonArray("content")
                }
                message.has("type") -> {
                    JsonArray().apply { add(message) }
                }
                else -> null
            }

            return contentArray?.mapNotNull { element ->
                val block = element.asJsonObject
                when (block.get("type")?.asString) {
                    "text" -> ContentBlock.Text(text = block.get("text")?.asString ?: "")
                    "tool_use" -> ContentBlock.ToolUse(
                        id = block.get("id")?.asString ?: "",
                        name = block.get("name")?.asString ?: "unknown",
                        input = gson.fromJson(
                            block.get("input")?.toString() ?: "{}",
                            Map::class.java
                        ) as? Map<String, Any> ?: emptyMap()
                    )
                    else -> null
                }
            } ?: emptyList()
        }
    }
}

sealed class SseEvent {
    data object Connected : SseEvent()
    data class Disconnected(val reason: String) : SseEvent()
    data class SystemInit(
        val subtype: String,
        val sessionId: String?,
        val model: String?,
        val tools: List<String>?,
        val eventId: Long? = null
    ) : SseEvent()
    data class AssistantMessage(
        val content: List<ContentBlock>,
        val eventId: Long? = null
    ) : SseEvent()
    data class Result(
        val resultText: String,
        val totalCostUsd: Double?,
        val eventId: Long? = null
    ) : SseEvent()
    data class Status(
        val status: String,
        val eventId: Long? = null
    ) : SseEvent()
    data class Exit(
        val code: Int,
        val eventId: Long? = null
    ) : SseEvent()
    data class Error(
        val message: String,
        val eventId: Long? = null
    ) : SseEvent()
    data class UserMessage(
        val content: String,
        val toolUseId: String? = null,
        val isError: Boolean = false,
        val isToolResult: Boolean = false,
        val eventId: Long? = null
    ) : SseEvent()
    data class ControlRequest(
        val requestId: String,
        val toolName: String,
        val toolInput: Map<String, Any>,
        val blockedPath: String? = null,
        val eventId: Long? = null
    ) : SseEvent()
    data class ControlResponse(
        val requestId: String,
        val approved: Boolean,
        val eventId: Long? = null
    ) : SseEvent()
    data class AskUserQuestion(
        val toolUseId: String,
        val questions: List<AskUserQuestionItem>,
        val eventId: Long? = null
    ) : SseEvent()
    data class PlanModeExit(
        val toolUseId: String,
        val input: Map<String, Any> = emptyMap(),
        val eventId: Long? = null
    ) : SseEvent()
    data object Ping : SseEvent()
}

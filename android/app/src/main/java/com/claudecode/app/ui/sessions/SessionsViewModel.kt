package com.claudecode.app.ui.sessions

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.claudecode.app.data.SettingsRepository
import com.claudecode.app.data.model.Session
import com.claudecode.app.network.ApiClient
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

class SessionsViewModel(
    private val apiClient: ApiClient,
    settingsRepository: SettingsRepository
) : ViewModel() {

    val defaultWorkingDir: StateFlow<String> = settingsRepository.lastWorkingDirectory
        .stateIn(viewModelScope, SharingStarted.Eagerly, "")

    private val _sessions = MutableStateFlow<List<Session>>(emptyList())
    val sessions: StateFlow<List<Session>> = _sessions.asStateFlow()

    private val _isLoading = MutableStateFlow(false)
    val isLoading: StateFlow<Boolean> = _isLoading.asStateFlow()

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()

    init {
        loadSessions()
    }

    fun loadSessions() {
        viewModelScope.launch {
            _isLoading.value = true
            _error.value = null
            apiClient.listSessions().fold(
                onSuccess = { sessions ->
                    _sessions.value = sessions
                },
                onFailure = { e ->
                    _error.value = e.message
                }
            )
            _isLoading.value = false
        }
    }

    fun createSession(
        workingDirectory: String? = null,
        additionalFlags: List<String>? = null,
        dangerouslySkipPermissions: Boolean = false
    ) {
        viewModelScope.launch {
            _isLoading.value = true
            apiClient.createSession(
                workingDirectory = workingDirectory,
                additionalFlags = additionalFlags,
                dangerouslySkipPermissions = dangerouslySkipPermissions
            ).fold(
                onSuccess = {
                    loadSessions()
                },
                onFailure = { e ->
                    _error.value = e.message
                    _isLoading.value = false
                }
            )
        }
    }

    fun deleteSession(sessionId: String) {
        viewModelScope.launch {
            apiClient.deleteSession(sessionId).fold(
                onSuccess = {
                    _sessions.value = _sessions.value.filter { it.id != sessionId }
                },
                onFailure = { e ->
                    _error.value = e.message
                }
            )
        }
    }

    fun clearError() {
        _error.value = null
    }
}

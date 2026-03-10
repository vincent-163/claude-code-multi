package com.claudecode.app.ui.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.claudecode.app.data.SettingsRepository
import com.claudecode.app.network.ApiClient
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

class SettingsViewModel(
    private val settingsRepository: SettingsRepository,
    private val apiClient: ApiClient
) : ViewModel() {

    private val _defaultModel = MutableStateFlow("")
    val defaultModel: StateFlow<String> = _defaultModel.asStateFlow()

    private val _lastWorkingDir = MutableStateFlow("")
    val lastWorkingDir: StateFlow<String> = _lastWorkingDir.asStateFlow()

    private val _serverCommand = MutableStateFlow("claude-code-server")
    val serverCommand: StateFlow<String> = _serverCommand.asStateFlow()

    private val _authToken = MutableStateFlow("")
    val authToken: StateFlow<String> = _authToken.asStateFlow()

    private val _theme = MutableStateFlow("dark")
    val theme: StateFlow<String> = _theme.asStateFlow()

    init {
        viewModelScope.launch {
            _defaultModel.value = settingsRepository.defaultModel.first()
            _lastWorkingDir.value = settingsRepository.lastWorkingDirectory.first()
            _authToken.value = settingsRepository.authToken.first()
            _theme.value = settingsRepository.theme.first()
            val config = settingsRepository.sshConfig.first()
            _serverCommand.value = config.serverCommand
        }
    }

    fun updateDefaultModel(model: String) {
        _defaultModel.value = model
        viewModelScope.launch {
            settingsRepository.saveDefaultModel(model)
        }
    }

    fun updateLastWorkingDir(dir: String) {
        _lastWorkingDir.value = dir
        viewModelScope.launch {
            settingsRepository.saveLastWorkingDirectory(dir)
        }
    }

    fun updateServerCommand(command: String) {
        _serverCommand.value = command
        viewModelScope.launch {
            val config = settingsRepository.sshConfig.first()
            settingsRepository.saveSshConfig(config.copy(serverCommand = command))
        }
    }

    fun updateAuthToken(token: String) {
        _authToken.value = token
        apiClient.authToken = token.ifBlank { null }
        viewModelScope.launch {
            settingsRepository.saveAuthToken(token)
        }
    }

    fun updateTheme(theme: String) {
        _theme.value = theme
        viewModelScope.launch {
            settingsRepository.saveTheme(theme)
        }
    }
}

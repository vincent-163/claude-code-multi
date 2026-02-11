package com.claudecode.app.ui.navigation

import androidx.activity.compose.BackHandler
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import com.claudecode.app.ClaudeCodeApp
import com.claudecode.app.ui.chat.ChatScreen
import com.claudecode.app.ui.chat.ChatViewModel
import com.claudecode.app.ui.connection.ConnectionScreen
import com.claudecode.app.ui.connection.ConnectionViewModel
import com.claudecode.app.ui.sessions.SessionsScreen
import com.claudecode.app.ui.sessions.SessionsViewModel
import com.claudecode.app.ui.settings.SettingsScreen
import com.claudecode.app.ui.settings.SettingsViewModel

sealed class Screen {
    data object Connection : Screen()
    data object Sessions : Screen()
    data class Chat(val sessionId: String) : Screen()
    data object Settings : Screen()
}

@Composable
fun AppNavigation() {
    val app = LocalContext.current.applicationContext as ClaudeCodeApp
    var currentScreen: Screen by remember { mutableStateOf(Screen.Connection) }
    var previousScreen: Screen by remember { mutableStateOf<Screen>(Screen.Connection) }

    val connectionViewModel = remember {
        ConnectionViewModel(app.sshManager, app.apiClient, app.settingsRepository)
    }

    when (val screen = currentScreen) {
        is Screen.Connection -> {
            ConnectionScreen(
                viewModel = connectionViewModel,
                onConnected = {
                    previousScreen = currentScreen
                    currentScreen = Screen.Sessions
                }
            )
        }

        is Screen.Sessions -> {
            BackHandler { currentScreen = Screen.Connection }
            val sessionsViewModel = remember { SessionsViewModel(app.apiClient) }
            SessionsScreen(
                viewModel = sessionsViewModel,
                onSessionSelected = { sessionId ->
                    previousScreen = currentScreen
                    currentScreen = Screen.Chat(sessionId)
                },
                onDisconnect = {
                    connectionViewModel.disconnect()
                    currentScreen = Screen.Connection
                },
                onSettings = {
                    previousScreen = currentScreen
                    currentScreen = Screen.Settings
                }
            )
        }

        is Screen.Chat -> {
            BackHandler { currentScreen = Screen.Sessions }
            val chatViewModel = remember(screen.sessionId) {
                ChatViewModel(app.apiClient, screen.sessionId)
            }
            ChatScreen(
                viewModel = chatViewModel,
                onBack = { currentScreen = Screen.Sessions }
            )
        }

        is Screen.Settings -> {
            BackHandler { currentScreen = previousScreen }
            val settingsViewModel = remember {
                SettingsViewModel(app.settingsRepository, app.apiClient)
            }
            SettingsScreen(
                viewModel = settingsViewModel,
                onBack = { currentScreen = previousScreen }
            )
        }
    }
}

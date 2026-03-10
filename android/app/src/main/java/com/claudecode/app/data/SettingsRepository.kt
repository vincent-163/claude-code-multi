package com.claudecode.app.data

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.claudecode.app.data.model.AuthMethod
import com.claudecode.app.data.model.ConnectionMode
import com.claudecode.app.data.model.SshConfig
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "settings")

class SettingsRepository(
    private val context: Context
) {
    private object Keys {
        val CONNECTION_MODE = stringPreferencesKey("connection_mode")
        val SSH_HOST = stringPreferencesKey("ssh_host")
        val SSH_PORT = intPreferencesKey("ssh_port")
        val SSH_USERNAME = stringPreferencesKey("ssh_username")
        val SSH_AUTH_METHOD = stringPreferencesKey("ssh_auth_method")
        val SSH_PRIVATE_KEY_PATH = stringPreferencesKey("ssh_private_key_path")
        val SSH_PRIVATE_KEY_CONTENT = stringPreferencesKey("ssh_private_key_content")
        val SSH_REMOTE_PORT = intPreferencesKey("ssh_remote_port")
        val SSH_LOCAL_PORT = intPreferencesKey("ssh_local_port")
        val SSH_SERVER_COMMAND = stringPreferencesKey("ssh_server_command")
        val DIRECT_API_URL = stringPreferencesKey("direct_api_url")
        val LAST_WORKING_DIR = stringPreferencesKey("last_working_dir")
        val DEFAULT_MODEL = stringPreferencesKey("default_model")
        val AUTH_TOKEN = stringPreferencesKey("auth_token")
        val THEME = stringPreferencesKey("theme")
    }

    val sshConfig: Flow<SshConfig> = context.dataStore.data.map { prefs ->
        SshConfig(
            connectionMode = when (prefs[Keys.CONNECTION_MODE]) {
                "direct" -> ConnectionMode.DirectAPI
                else -> ConnectionMode.SSH
            },
            host = prefs[Keys.SSH_HOST] ?: "",
            port = prefs[Keys.SSH_PORT] ?: 22,
            username = prefs[Keys.SSH_USERNAME] ?: "",
            authMethod = when (prefs[Keys.SSH_AUTH_METHOD]) {
                "key" -> AuthMethod.PrivateKey
                else -> AuthMethod.Password
            },
            privateKeyPath = prefs[Keys.SSH_PRIVATE_KEY_PATH] ?: "",
            privateKeyContent = prefs[Keys.SSH_PRIVATE_KEY_CONTENT] ?: "",
            remotePort = prefs[Keys.SSH_REMOTE_PORT] ?: 8080,
            localPort = prefs[Keys.SSH_LOCAL_PORT] ?: 8080,
            serverCommand = prefs[Keys.SSH_SERVER_COMMAND] ?: "claude-code-server",
            directApiUrl = prefs[Keys.DIRECT_API_URL] ?: ""
        )
    }

    val lastWorkingDirectory: Flow<String> = context.dataStore.data.map { prefs ->
        prefs[Keys.LAST_WORKING_DIR] ?: ""
    }

    val defaultModel: Flow<String> = context.dataStore.data.map { prefs ->
        prefs[Keys.DEFAULT_MODEL] ?: ""
    }

    val authToken: Flow<String> = context.dataStore.data.map { prefs ->
        prefs[Keys.AUTH_TOKEN] ?: ""
    }

    val theme: Flow<String> = context.dataStore.data.map { prefs ->
        prefs[Keys.THEME] ?: "dark"
    }

    suspend fun saveSshConfig(config: SshConfig) {
        context.dataStore.edit { prefs ->
            prefs[Keys.CONNECTION_MODE] = when (config.connectionMode) {
                ConnectionMode.DirectAPI -> "direct"
                ConnectionMode.SSH -> "ssh"
            }
            prefs[Keys.SSH_HOST] = config.host
            prefs[Keys.SSH_PORT] = config.port
            prefs[Keys.SSH_USERNAME] = config.username
            prefs[Keys.SSH_AUTH_METHOD] = when (config.authMethod) {
                AuthMethod.PrivateKey -> "key"
                AuthMethod.Password -> "password"
            }
            prefs[Keys.SSH_PRIVATE_KEY_PATH] = config.privateKeyPath
            prefs[Keys.SSH_PRIVATE_KEY_CONTENT] = config.privateKeyContent
            prefs[Keys.SSH_REMOTE_PORT] = config.remotePort
            prefs[Keys.SSH_LOCAL_PORT] = config.localPort
            prefs[Keys.SSH_SERVER_COMMAND] = config.serverCommand
            prefs[Keys.DIRECT_API_URL] = config.directApiUrl
        }
    }

    suspend fun saveLastWorkingDirectory(dir: String) {
        context.dataStore.edit { prefs ->
            prefs[Keys.LAST_WORKING_DIR] = dir
        }
    }

    suspend fun saveDefaultModel(model: String) {
        context.dataStore.edit { prefs ->
            prefs[Keys.DEFAULT_MODEL] = model
        }
    }

    suspend fun saveAuthToken(token: String) {
        context.dataStore.edit { prefs ->
            prefs[Keys.AUTH_TOKEN] = token
        }
    }

    suspend fun saveTheme(theme: String) {
        context.dataStore.edit { prefs ->
            prefs[Keys.THEME] = theme
        }
    }
}

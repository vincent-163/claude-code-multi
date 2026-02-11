package com.claudecode.app.ui.sessions

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Circle
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Logout
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.claudecode.app.data.model.Session
import com.claudecode.app.data.model.SessionStatus
import com.claudecode.app.ui.theme.AccentBlue
import com.claudecode.app.ui.theme.AccentGreen
import com.claudecode.app.ui.theme.AccentOrange
import com.claudecode.app.ui.theme.AccentRed
import com.claudecode.app.ui.theme.TextSecondary

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SessionsScreen(
    viewModel: SessionsViewModel,
    onSessionSelected: (String) -> Unit,
    onDisconnect: () -> Unit,
    onSettings: () -> Unit
) {
    val sessions by viewModel.sessions.collectAsState()
    val isLoading by viewModel.isLoading.collectAsState()
    val error by viewModel.error.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }
    var showNewSessionDialog by remember { mutableStateOf(false) }

    LaunchedEffect(error) {
        error?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.clearError()
        }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(
                title = { Text("Sessions") },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface
                ),
                actions = {
                    IconButton(onClick = { viewModel.loadSessions() }) {
                        Icon(Icons.Default.Refresh, contentDescription = "Refresh")
                    }
                    IconButton(onClick = onSettings) {
                        Icon(Icons.Default.Settings, contentDescription = "Settings")
                    }
                    IconButton(onClick = onDisconnect) {
                        Icon(Icons.Default.Logout, contentDescription = "Disconnect")
                    }
                }
            )
        },
        floatingActionButton = {
            FloatingActionButton(
                onClick = { showNewSessionDialog = true },
                containerColor = MaterialTheme.colorScheme.primary
            ) {
                Icon(Icons.Default.Add, contentDescription = "New Session")
            }
        }
    ) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            if (isLoading && sessions.isEmpty()) {
                CircularProgressIndicator(
                    modifier = Modifier.align(Alignment.Center)
                )
            } else if (sessions.isEmpty()) {
                Column(
                    modifier = Modifier.align(Alignment.Center),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Text(
                        "No sessions",
                        style = MaterialTheme.typography.titleMedium,
                        color = TextSecondary
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        "Tap + to create a new session",
                        style = MaterialTheme.typography.bodyMedium,
                        color = TextSecondary
                    )
                }
            } else {
                LazyColumn(
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    items(sessions, key = { it.id }) { session ->
                        SessionCard(
                            session = session,
                            onClick = { onSessionSelected(session.id) },
                            onDelete = { viewModel.deleteSession(session.id) }
                        )
                    }
                }
            }
        }
    }

    if (showNewSessionDialog) {
        val defaultWorkingDir by viewModel.defaultWorkingDir.collectAsState()
        NewSessionDialog(
            initialWorkingDir = defaultWorkingDir,
            onDismiss = { showNewSessionDialog = false },
            onCreate = { workingDir, skipPermissions, extraFlags ->
                showNewSessionDialog = false
                viewModel.createSession(
                    workingDirectory = workingDir.ifBlank { null },
                    additionalFlags = extraFlags.ifEmpty { null },
                    dangerouslySkipPermissions = skipPermissions
                )
            }
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SessionCard(
    session: Session,
    onClick: () -> Unit,
    onDelete: () -> Unit
) {
    Card(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant
        )
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                Icons.Default.Circle,
                contentDescription = null,
                modifier = Modifier.size(12.dp),
                tint = when (session.status) {
                    SessionStatus.Ready -> AccentGreen
                    SessionStatus.Busy -> AccentOrange
                    SessionStatus.Starting -> AccentOrange
                    SessionStatus.WaitingForInput -> AccentBlue
                    SessionStatus.Dead, SessionStatus.Destroyed -> AccentRed
                }
            )
            Spacer(modifier = Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    session.id,
                    style = MaterialTheme.typography.titleSmall
                )
                if (session.workingDirectory.isNotBlank()) {
                    Text(
                        session.workingDirectory,
                        style = MaterialTheme.typography.bodySmall,
                        color = TextSecondary
                    )
                }
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    val statusLabel = when (session.status) {
                        SessionStatus.WaitingForInput -> "waiting for input"
                        else -> session.status.name.lowercase()
                    }
                    val statusColor = when (session.status) {
                        SessionStatus.Ready -> AccentGreen
                        SessionStatus.Busy -> AccentOrange
                        SessionStatus.WaitingForInput -> AccentBlue
                        SessionStatus.Starting -> AccentOrange
                        SessionStatus.Dead, SessionStatus.Destroyed -> AccentRed
                    }
                    Text(
                        statusLabel,
                        style = MaterialTheme.typography.labelSmall,
                        color = statusColor
                    )
                    session.totalCostUsd?.let { cost ->
                        if (cost > 0) {
                            Text(
                                "$${String.format("%.4f", cost)}",
                                style = MaterialTheme.typography.labelSmall,
                                color = TextSecondary
                            )
                        }
                    }
                }
            }
            IconButton(onClick = onDelete) {
                Icon(
                    Icons.Default.Delete,
                    contentDescription = "Delete",
                    tint = MaterialTheme.colorScheme.error
                )
            }
        }
    }
}

@Composable
private fun NewSessionDialog(
    initialWorkingDir: String = "",
    onDismiss: () -> Unit,
    onCreate: (String, Boolean, List<String>) -> Unit
) {
    var workingDir by remember { mutableStateOf(initialWorkingDir) }
    var skipPermissions by remember { mutableStateOf(false) }
    var extraFlags by remember { mutableStateOf("") }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("New Session") },
        text = {
            Column {
                Text(
                    "Create a new Claude Code session.",
                    style = MaterialTheme.typography.bodyMedium
                )
                Spacer(modifier = Modifier.height(16.dp))
                OutlinedTextField(
                    value = workingDir,
                    onValueChange = { workingDir = it },
                    label = { Text("Working Directory (optional)") },
                    placeholder = { Text("/path/to/project") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
                Spacer(modifier = Modifier.height(8.dp))
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Checkbox(
                        checked = skipPermissions,
                        onCheckedChange = { skipPermissions = it }
                    )
                    Text(
                        "Skip permissions",
                        style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.padding(start = 4.dp)
                    )
                }
                Spacer(modifier = Modifier.height(8.dp))
                OutlinedTextField(
                    value = extraFlags,
                    onValueChange = { extraFlags = it },
                    label = { Text("Extra flags (optional)") },
                    placeholder = { Text("--flag1 --flag2 value") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
            }
        },
        confirmButton = {
            TextButton(onClick = {
                val flags = extraFlags.trim()
                    .split("\\s+".toRegex())
                    .filter { it.isNotBlank() }
                onCreate(workingDir, skipPermissions, flags)
            }) {
                Text("Create")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Cancel")
            }
        }
    )
}

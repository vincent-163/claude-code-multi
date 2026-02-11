package com.claudecode.app.ui.chat

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.widget.Toast
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Send
import androidx.compose.material.icons.filled.Build
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Circle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.claudecode.app.data.model.ChatMessage
import com.claudecode.app.data.model.ContentBlock
import com.claudecode.app.ui.theme.AccentBlue
import com.claudecode.app.ui.theme.AccentGreen
import com.claudecode.app.ui.theme.AccentOrange
import com.claudecode.app.ui.theme.AccentPurple
import com.claudecode.app.ui.theme.AccentRed
import com.claudecode.app.ui.theme.AssistantBubble
import com.claudecode.app.ui.theme.CodeBackground
import com.claudecode.app.ui.theme.TextMuted
import com.claudecode.app.ui.theme.TextSecondary
import com.claudecode.app.ui.theme.UserBubble

private fun copyToClipboard(context: Context, text: String) {
    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    clipboard.setPrimaryClip(ClipData.newPlainText("message", text))
    Toast.makeText(context, "Copied to clipboard", Toast.LENGTH_SHORT).show()
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
@Composable
fun ChatScreen(
    viewModel: ChatViewModel,
    onBack: () -> Unit
) {
    val messages by viewModel.messages.collectAsState()
    val sessionStatus by viewModel.sessionStatus.collectAsState()
    val isConnected by viewModel.isConnected.collectAsState()
    val modelName by viewModel.modelName.collectAsState()
    val totalCost by viewModel.totalCost.collectAsState()
    var inputText by remember { mutableStateOf("") }
    val listState = rememberLazyListState()

    LaunchedEffect(messages.size) {
        if (messages.isNotEmpty()) {
            listState.animateScrollToItem(messages.size - 1)
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                modelName ?: viewModel.sessionId.take(12),
                                style = MaterialTheme.typography.titleMedium
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                            Icon(
                                Icons.Default.Circle,
                                contentDescription = null,
                                modifier = Modifier.size(8.dp),
                                tint = when (sessionStatus) {
                                    "ready", "connected" -> AccentGreen
                                    "busy" -> AccentOrange
                                    else -> AccentRed
                                }
                            )
                            Spacer(modifier = Modifier.width(4.dp))
                            Text(
                                sessionStatus,
                                style = MaterialTheme.typography.labelSmall,
                                color = TextSecondary
                            )
                        }
                        if (totalCost > 0) {
                            Text(
                                "$${String.format("%.4f", totalCost)}",
                                style = MaterialTheme.typography.labelSmall,
                                color = TextMuted
                            )
                        }
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    if (sessionStatus == "busy") {
                        IconButton(onClick = { viewModel.sendInterrupt() }) {
                            Icon(
                                Icons.Default.Stop,
                                contentDescription = "Interrupt",
                                tint = AccentRed
                            )
                        }
                    }
                    if (!isConnected) {
                        IconButton(onClick = { viewModel.reconnect() }) {
                            Icon(Icons.Default.Refresh, contentDescription = "Reconnect")
                        }
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface
                )
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .imePadding()
        ) {
            LazyColumn(
                state = listState,
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth(),
                contentPadding = PaddingValues(horizontal = 12.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                items(messages, key = { it.id }) { message ->
                    MessageItem(message, viewModel)
                }
            }

            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(MaterialTheme.colorScheme.surface)
                    .padding(horizontal = 12.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                OutlinedTextField(
                    value = inputText,
                    onValueChange = { inputText = it },
                    placeholder = {
                        Text(if (sessionStatus == "busy") "Claude is working..." else "Message Claude Code...")
                    },
                    modifier = Modifier.weight(1f),
                    maxLines = 4,
                    colors = TextFieldDefaults.outlinedTextFieldColors(
                        focusedBorderColor = MaterialTheme.colorScheme.primary,
                        unfocusedBorderColor = MaterialTheme.colorScheme.outline
                    )
                )
                Spacer(modifier = Modifier.width(8.dp))
                if (sessionStatus == "busy") {
                    IconButton(
                        onClick = { viewModel.sendInterrupt() },
                        enabled = isConnected
                    ) {
                        Icon(
                            Icons.Default.Stop,
                            contentDescription = "Stop",
                            tint = if (isConnected) AccentRed else TextMuted
                        )
                    }
                } else {
                    IconButton(
                        onClick = {
                            if (inputText.isNotBlank()) {
                                viewModel.sendMessage(inputText.trim())
                                inputText = ""
                            }
                        },
                        enabled = inputText.isNotBlank() && isConnected
                    ) {
                        Icon(
                            Icons.Default.Send,
                            contentDescription = "Send",
                            tint = if (inputText.isNotBlank() && isConnected) {
                                MaterialTheme.colorScheme.primary
                            } else {
                                TextMuted
                            }
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun MessageItem(message: ChatMessage, viewModel: ChatViewModel) {
    when (message) {
        is ChatMessage.UserMessage -> UserMessageBubble(message)
        is ChatMessage.AssistantMessage -> AssistantMessageBlock(message)
        is ChatMessage.ResultMessage -> ResultMessageBlock(message)
        is ChatMessage.SystemMessage -> SystemMessageBlock(message)
        is ChatMessage.StatusMessage -> StatusMessageBlock(message)
        is ChatMessage.ErrorMessage -> ErrorMessageBlock(message)
        is ChatMessage.ExitMessage -> ExitMessageBlock(message)
        is ChatMessage.ControlRequest -> ToolApprovalBlock(message, viewModel)
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun UserMessageBubble(message: ChatMessage.UserMessage) {
    val context = LocalContext.current
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.End
    ) {
        Box(
            modifier = Modifier
                .clip(RoundedCornerShape(12.dp, 12.dp, 4.dp, 12.dp))
                .background(UserBubble)
                .combinedClickable(
                    onClick = {},
                    onLongClick = { copyToClipboard(context, message.content) }
                )
                .padding(12.dp)
        ) {
            Text(
                message.content,
                color = MaterialTheme.colorScheme.onSurface,
                style = MaterialTheme.typography.bodyMedium
            )
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun AssistantMessageBlock(message: ChatMessage.AssistantMessage) {
    val context = LocalContext.current
    val copyText = remember(message.content) {
        message.content.joinToString("\n\n") { block ->
            when (block) {
                is ContentBlock.Text -> block.text
                is ContentBlock.ToolUse -> "[${block.name}] " + block.input.entries.joinToString(", ") { (k, v) -> "$k: $v" }
            }
        }
    }
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .combinedClickable(
                onClick = {},
                onLongClick = { copyToClipboard(context, copyText) }
            ),
        verticalArrangement = Arrangement.spacedBy(4.dp)
    ) {
        for (block in message.content) {
            when (block) {
                is ContentBlock.Text -> {
                    SelectionContainer {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(8.dp))
                                .background(AssistantBubble)
                                .padding(12.dp)
                        ) {
                            Text(
                                block.text,
                                color = MaterialTheme.colorScheme.onSurface,
                                style = MaterialTheme.typography.bodyMedium
                            )
                        }
                    }
                }
                is ContentBlock.ToolUse -> {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(8.dp))
                            .background(CodeBackground)
                            .padding(10.dp)
                    ) {
                        Column {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(
                                    Icons.Default.Build,
                                    contentDescription = null,
                                    modifier = Modifier.size(14.dp),
                                    tint = AccentPurple
                                )
                                Spacer(modifier = Modifier.width(6.dp))
                                Text(
                                    block.name,
                                    style = MaterialTheme.typography.labelMedium,
                                    fontWeight = FontWeight.Bold,
                                    color = AccentPurple
                                )
                            }
                            if (block.input.isNotEmpty()) {
                                Spacer(modifier = Modifier.height(4.dp))
                                val inputPreview = block.input.entries.joinToString(", ") { (k, v) ->
                                    val valueStr = v.toString()
                                    "$k: ${if (valueStr.length > 60) valueStr.take(60) + "..." else valueStr}"
                                }
                                Text(
                                    inputPreview,
                                    fontFamily = FontFamily.Monospace,
                                    fontSize = 12.sp,
                                    color = TextSecondary,
                                    maxLines = 3
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ResultMessageBlock(message: ChatMessage.ResultMessage) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .background(AccentGreen.copy(alpha = 0.08f))
            .padding(10.dp)
    ) {
        if (message.resultText.isNotBlank()) {
            Text(
                message.resultText,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurface
            )
        }
        message.totalCostUsd?.let { cost ->
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                "Cost: $${String.format("%.4f", cost)}",
                style = MaterialTheme.typography.labelSmall,
                color = TextMuted
            )
        }
    }
}

@Composable
private fun SystemMessageBlock(message: ChatMessage.SystemMessage) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
        horizontalArrangement = Arrangement.Center
    ) {
        val text = when (message.subtype) {
            "init" -> "Session initialized" + (message.model?.let { " ($it)" } ?: "")
            else -> "System: ${message.subtype}"
        }
        Text(
            text,
            style = MaterialTheme.typography.labelSmall,
            color = AccentBlue
        )
    }
}

@Composable
private fun StatusMessageBlock(message: ChatMessage.StatusMessage) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
        horizontalArrangement = Arrangement.Center
    ) {
        Text(
            "-- ${message.status} --",
            style = MaterialTheme.typography.labelSmall,
            color = TextMuted
        )
    }
}

@Composable
private fun ErrorMessageBlock(message: ChatMessage.ErrorMessage) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .background(AccentRed.copy(alpha = 0.15f))
            .padding(10.dp)
    ) {
        Text(
            message.content,
            color = AccentRed,
            style = MaterialTheme.typography.bodySmall,
            fontFamily = FontFamily.Monospace
        )
    }
}

@Composable
private fun ExitMessageBlock(message: ChatMessage.ExitMessage) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
        horizontalArrangement = Arrangement.Center
    ) {
        Text(
            "Process exited with code ${message.exitCode}",
            style = MaterialTheme.typography.labelSmall,
            color = if (message.exitCode == 0) AccentGreen else AccentRed
        )
    }
}

@Composable
private fun ToolApprovalBlock(message: ChatMessage.ControlRequest, viewModel: ChatViewModel) {
    val pendingResponses by viewModel.pendingControlResponses.collectAsState()
    val isPending = pendingResponses.contains(message.requestId)

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .background(AccentOrange.copy(alpha = 0.12f))
            .padding(12.dp)
    ) {
        Column {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    Icons.Default.Build,
                    contentDescription = null,
                    modifier = Modifier.size(16.dp),
                    tint = AccentOrange
                )
                Spacer(modifier = Modifier.width(6.dp))
                Text(
                    "Permission Required",
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.Bold,
                    color = AccentOrange
                )
            }
            Spacer(modifier = Modifier.height(6.dp))
            Text(
                message.toolName,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onSurface
            )
            if (message.toolInput.isNotEmpty()) {
                Spacer(modifier = Modifier.height(4.dp))
                val inputPreview = message.toolInput.entries.joinToString(", ") { (k, v) ->
                    val valueStr = v.toString()
                    "$k: ${if (valueStr.length > 80) valueStr.take(80) + "..." else valueStr}"
                }
                Text(
                    inputPreview,
                    fontFamily = FontFamily.Monospace,
                    fontSize = 12.sp,
                    color = TextSecondary,
                    maxLines = 4
                )
            }
            Spacer(modifier = Modifier.height(10.dp))
            when {
                message.approved == true -> {
                    Text(
                        "Allowed",
                        style = MaterialTheme.typography.labelMedium,
                        color = AccentGreen,
                        fontWeight = FontWeight.Bold
                    )
                }
                message.approved == false -> {
                    Text(
                        "Denied",
                        style = MaterialTheme.typography.labelMedium,
                        color = AccentRed,
                        fontWeight = FontWeight.Bold
                    )
                }
                isPending -> {
                    Text(
                        "Sending...",
                        style = MaterialTheme.typography.labelMedium,
                        color = TextMuted,
                        fontWeight = FontWeight.Bold
                    )
                }
                else -> {
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Button(
                            onClick = { viewModel.approveControlRequest(message.requestId, message.toolInput) },
                            colors = ButtonDefaults.buttonColors(
                                containerColor = AccentGreen
                            )
                        ) {
                            Icon(
                                Icons.Default.Check,
                                contentDescription = null,
                                modifier = Modifier.size(16.dp)
                            )
                            Spacer(modifier = Modifier.width(4.dp))
                            Text("Allow")
                        }
                        OutlinedButton(
                            onClick = { viewModel.denyControlRequest(message.requestId) }
                        ) {
                            Icon(
                                Icons.Default.Close,
                                contentDescription = null,
                                modifier = Modifier.size(16.dp),
                                tint = AccentRed
                            )
                            Spacer(modifier = Modifier.width(4.dp))
                            Text("Deny", color = AccentRed)
                        }
                    }
                }
            }
        }
    }
}

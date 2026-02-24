package com.claudecode.app.ui.chat

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.widget.Toast
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.clickable
import androidx.compose.animation.animateContentSize
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
import androidx.compose.material.icons.filled.QuestionAnswer
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
import androidx.compose.material3.TextField
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
import com.claudecode.app.data.model.AskUserQuestionItem
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
    val isBusy by viewModel.isBusy.collectAsState()
    val isConnected by viewModel.isConnected.collectAsState()
    val modelName by viewModel.modelName.collectAsState()
    val totalCost by viewModel.totalCost.collectAsState()
    val title by viewModel.title.collectAsState()
    var inputText by remember { mutableStateOf("") }
    var editingTitle by remember { mutableStateOf(false) }
    var editTitleValue by remember { mutableStateOf("") }
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
                        if (editingTitle) {
                            TextField(
                                value = editTitleValue,
                                onValueChange = { editTitleValue = it },
                                singleLine = true,
                                textStyle = MaterialTheme.typography.titleMedium,
                                colors = TextFieldDefaults.colors(
                                    focusedContainerColor = MaterialTheme.colorScheme.surface,
                                    unfocusedContainerColor = MaterialTheme.colorScheme.surface,
                                    focusedIndicatorColor = AccentBlue,
                                ),
                                modifier = Modifier.fillMaxWidth(),
                                trailingIcon = {
                                    Row {
                                        IconButton(onClick = {
                                            viewModel.updateTitle(editTitleValue)
                                            editingTitle = false
                                        }) {
                                            Icon(Icons.Default.Check, contentDescription = "Save", tint = AccentGreen)
                                        }
                                        IconButton(onClick = { editingTitle = false }) {
                                            Icon(Icons.Default.Close, contentDescription = "Cancel", tint = AccentRed)
                                        }
                                    }
                                }
                            )
                        } else {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                modifier = Modifier.clickable {
                                    editTitleValue = title ?: ""
                                    editingTitle = true
                                }
                            ) {
                                Text(
                                    title ?: modelName ?: viewModel.sessionId.take(12),
                                    style = MaterialTheme.typography.titleMedium
                                )
                                Spacer(modifier = Modifier.width(8.dp))
                                Icon(
                                    Icons.Default.Circle,
                                    contentDescription = null,
                                    modifier = Modifier.size(8.dp),
                                    tint = when {
                                        isBusy -> AccentOrange
                                        sessionStatus in listOf("ready", "connected", "running") -> AccentGreen
                                        else -> AccentRed
                                    }
                                )
                                Spacer(modifier = Modifier.width(4.dp))
                                Text(
                                    if (isBusy) "busy" else sessionStatus,
                                    style = MaterialTheme.typography.labelSmall,
                                    color = TextSecondary
                                )
                            }
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
                    if (isBusy) {
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
                        Text(if (isBusy) "Claude is working..." else "Message Claude Code...")
                    },
                    modifier = Modifier.weight(1f),
                    maxLines = 4,
                    colors = TextFieldDefaults.outlinedTextFieldColors(
                        focusedBorderColor = MaterialTheme.colorScheme.primary,
                        unfocusedBorderColor = MaterialTheme.colorScheme.outline
                    )
                )
                Spacer(modifier = Modifier.width(8.dp))
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
        is ChatMessage.AskUserQuestion -> AskUserQuestionBlock(message, viewModel)
        is ChatMessage.PlanModeExit -> PlanModeExitBlock(message, viewModel)
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
                is ContentBlock.ToolResult -> block.content
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
                    var expanded by remember { mutableStateOf(false) }
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(8.dp))
                            .background(CodeBackground)
                            .clickable { expanded = !expanded }
                            .animateContentSize()
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
                                Spacer(modifier = Modifier.weight(1f))
                                Text(
                                    if (expanded) "▲" else "▼",
                                    fontSize = 10.sp,
                                    color = TextMuted
                                )
                            }
                            if (block.input.isNotEmpty()) {
                                Spacer(modifier = Modifier.height(4.dp))
                                if (expanded) {
                                    val fullInput = block.input.entries.joinToString("\n") { (k, v) ->
                                        "$k: ${v.toString()}"
                                    }
                                    Text(
                                        fullInput,
                                        fontFamily = FontFamily.Monospace,
                                        fontSize = 12.sp,
                                        color = TextSecondary
                                    )
                                } else {
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
                is ContentBlock.ToolResult -> {
                    var expanded by remember { mutableStateOf(false) }
                    val isLong = block.content.length > 200 || block.content.count { it == '\n' } > 5
                    val resultColor = if (block.isError) AccentRed else AccentGreen
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(8.dp))
                            .background(resultColor.copy(alpha = 0.08f))
                            .then(if (isLong) Modifier.clickable { expanded = !expanded } else Modifier)
                            .animateContentSize()
                            .padding(10.dp)
                    ) {
                        Column {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(
                                    if (block.isError) "✗ Error" else "✓ Result",
                                    style = MaterialTheme.typography.labelSmall,
                                    fontWeight = FontWeight.Bold,
                                    color = resultColor
                                )
                                if (isLong) {
                                    Spacer(modifier = Modifier.weight(1f))
                                    Text(
                                        if (expanded) "▲" else "▼",
                                        fontSize = 10.sp,
                                        color = TextMuted
                                    )
                                }
                            }
                            if (block.content.isNotBlank()) {
                                Spacer(modifier = Modifier.height(4.dp))
                                if (expanded || !isLong) {
                                    Text(
                                        block.content,
                                        fontFamily = FontFamily.Monospace,
                                        fontSize = 12.sp,
                                        color = TextSecondary
                                    )
                                } else {
                                    Text(
                                        block.content,
                                        fontFamily = FontFamily.Monospace,
                                        fontSize = 12.sp,
                                        color = TextSecondary,
                                        maxLines = 5
                                    )
                                }
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
    var expanded by remember { mutableStateOf(false) }
    val isLong = message.resultText.length > 200 || message.resultText.count { it == '\n' } > 5
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .background(AccentGreen.copy(alpha = 0.08f))
            .then(if (isLong) Modifier.clickable { expanded = !expanded } else Modifier)
            .animateContentSize()
            .padding(10.dp)
    ) {
        if (message.resultText.isNotBlank()) {
            if (expanded || !isLong) {
                Text(
                    message.resultText,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurface
                )
            } else {
                Text(
                    message.resultText,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurface,
                    maxLines = 5
                )
                Text(
                    "Tap to show more...",
                    fontSize = 11.sp,
                    color = TextMuted
                )
            }
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
    var expanded by remember { mutableStateOf(false) }

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .background(AccentOrange.copy(alpha = 0.12f))
            .animateContentSize()
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
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(4.dp))
                        .background(CodeBackground)
                        .clickable { expanded = !expanded }
                        .padding(8.dp)
                ) {
                    Column {
                        if (expanded) {
                            val fullInput = message.toolInput.entries.joinToString("\n") { (k, v) ->
                                "$k: ${v.toString()}"
                            }
                            Text(
                                fullInput,
                                fontFamily = FontFamily.Monospace,
                                fontSize = 12.sp,
                                color = TextSecondary
                            )
                        } else {
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
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.End
                        ) {
                            Text(
                                if (expanded) "▲ Less" else "▼ Details",
                                fontSize = 11.sp,
                                color = TextMuted
                            )
                        }
                    }
                }
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

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AskUserQuestionBlock(message: ChatMessage.AskUserQuestion, viewModel: ChatViewModel) {
    val answeredQuestions by viewModel.answeredQuestions.collectAsState()
    val isAnswered = message.answered || answeredQuestions.contains(message.toolUseId)
    var selections by remember { mutableStateOf<Map<Int, Any>>(emptyMap()) }
    var customInputs by remember { mutableStateOf<Map<Int, String>>(emptyMap()) }

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .background(AccentBlue.copy(alpha = 0.12f))
            .animateContentSize()
            .padding(12.dp)
    ) {
        Column {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    Icons.Default.QuestionAnswer,
                    contentDescription = null,
                    modifier = Modifier.size(16.dp),
                    tint = AccentBlue
                )
                Spacer(modifier = Modifier.width(6.dp))
                Text(
                    "Question",
                    style = MaterialTheme.typography.labelMedium,
                    fontWeight = FontWeight.Bold,
                    color = AccentBlue
                )
            }
            Spacer(modifier = Modifier.height(8.dp))

            for ((qi, q) in message.questions.withIndex()) {
                if (q.header.isNotBlank()) {
                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(4.dp))
                            .background(AccentBlue.copy(alpha = 0.2f))
                            .padding(horizontal = 6.dp, vertical = 2.dp)
                    ) {
                        Text(
                            q.header,
                            style = MaterialTheme.typography.labelSmall,
                            fontWeight = FontWeight.Bold,
                            color = AccentBlue
                        )
                    }
                    Spacer(modifier = Modifier.height(4.dp))
                }
                Text(
                    q.question,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurface
                )
                Spacer(modifier = Modifier.height(6.dp))

                // Render options + "Other"
                val allOptions = q.options + listOf(
                    com.claudecode.app.data.model.AskUserQuestionOption("Other", "")
                )
                for ((oi, opt) in allOptions.withIndex()) {
                    val isOther = opt.label == "Other" && oi == allOptions.lastIndex
                    val optLabel = opt.label
                    val sel = selections[qi]
                    @Suppress("UNCHECKED_CAST")
                    val isSelected = if (q.multiSelect) {
                        val selected = (sel as? List<String>) ?: emptyList()
                        if (isOther) selected.contains("__other__") else selected.contains(optLabel)
                    } else {
                        if (isOther) sel == "__other__" else sel == optLabel
                    }

                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 2.dp)
                            .clip(RoundedCornerShape(6.dp))
                            .background(
                                if (isSelected) AccentBlue.copy(alpha = 0.15f)
                                else CodeBackground
                            )
                            .then(
                                if (!isAnswered) Modifier.clickable {
                                    val clickLabel = if (isOther) "__other__" else optLabel
                                    @Suppress("UNCHECKED_CAST")
                                    selections = if (q.multiSelect) {
                                        val current = (selections[qi] as? List<String>) ?: emptyList()
                                        if (current.contains(clickLabel)) {
                                            selections + (qi to current.filter { it != clickLabel })
                                        } else {
                                            selections + (qi to current + clickLabel)
                                        }
                                    } else {
                                        selections + (qi to clickLabel)
                                    }
                                } else Modifier
                            )
                            .padding(10.dp)
                    ) {
                        Column {
                            Text(
                                opt.label,
                                style = MaterialTheme.typography.bodyMedium,
                                fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal,
                                color = if (isSelected) AccentBlue else MaterialTheme.colorScheme.onSurface
                            )
                            if (opt.description.isNotBlank()) {
                                Text(
                                    opt.description,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = TextMuted
                                )
                            }
                        }
                    }
                }

                // Custom input field for "Other"
                val selForOther = selections[qi]
                @Suppress("UNCHECKED_CAST")
                val hasOther = if (q.multiSelect) {
                    (selForOther as? List<String>)?.contains("__other__") == true
                } else {
                    selForOther == "__other__"
                }
                if (hasOther) {
                    Spacer(modifier = Modifier.height(4.dp))
                    OutlinedTextField(
                        value = customInputs[qi] ?: "",
                        onValueChange = { customInputs = customInputs + (qi to it) },
                        placeholder = { Text("Type your answer...") },
                        modifier = Modifier.fillMaxWidth(),
                        enabled = !isAnswered,
                        maxLines = 2,
                        colors = TextFieldDefaults.outlinedTextFieldColors(
                            focusedBorderColor = AccentBlue,
                            unfocusedBorderColor = MaterialTheme.colorScheme.outline
                        )
                    )
                }

                if (qi < message.questions.size - 1) {
                    Spacer(modifier = Modifier.height(12.dp))
                }
            }

            Spacer(modifier = Modifier.height(10.dp))

            if (isAnswered) {
                Text(
                    "Answered",
                    style = MaterialTheme.typography.labelMedium,
                    color = AccentGreen,
                    fontWeight = FontWeight.Bold
                )
            } else {
                val allAnswered = message.questions.indices.all { qi ->
                    val sel = selections[qi]
                    when {
                        sel == null -> false
                        sel is List<*> -> sel.isNotEmpty()
                        else -> true
                    }
                }
                Button(
                    onClick = {
                        val answers = mutableMapOf<String, String>()
                        for (qi in message.questions.indices) {
                            val sel = selections[qi]
                            @Suppress("UNCHECKED_CAST")
                            answers[qi.toString()] = when {
                                sel == "__other__" -> customInputs[qi] ?: ""
                                sel is List<*> -> {
                                    (sel as List<String>).joinToString(", ") { s ->
                                        if (s == "__other__") customInputs[qi] ?: "" else s
                                    }
                                }
                                sel is String -> sel
                                else -> ""
                            }
                        }
                        viewModel.answerQuestion(message.toolUseId, answers)
                    },
                    enabled = allAnswered,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = AccentBlue
                    )
                ) {
                    Icon(
                        Icons.Default.Send,
                        contentDescription = null,
                        modifier = Modifier.size(16.dp)
                    )
                    Spacer(modifier = Modifier.width(4.dp))
                    Text("Submit")
                }
            }
        }
    }
}

@Composable
fun PlanModeExitBlock(message: ChatMessage.PlanModeExit, viewModel: ChatViewModel) {
    val resolvedPlanExits by viewModel.resolvedPlanExits.collectAsState()
    val isResolved = message.resolved || resolvedPlanExits.contains(message.toolUseId)

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 4.dp)
            .clip(RoundedCornerShape(8.dp))
            .background(CodeBackground)
            .padding(12.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(
                Icons.Default.Build,
                contentDescription = null,
                tint = AccentOrange,
                modifier = Modifier.size(18.dp)
            )
            Spacer(modifier = Modifier.width(8.dp))
            Text(
                "Exit Plan Mode",
                color = AccentOrange,
                fontWeight = FontWeight.Bold,
                fontSize = 14.sp
            )
        }
        Spacer(modifier = Modifier.height(6.dp))
        Text(
            "Claude wants to exit plan mode and begin implementation.",
            color = TextSecondary,
            fontSize = 13.sp
        )
        Spacer(modifier = Modifier.height(8.dp))
        if (isResolved) {
            Text(
                "Approved",
                color = AccentGreen,
                fontWeight = FontWeight.Bold,
                fontSize = 13.sp
            )
        } else {
            Button(
                onClick = { viewModel.approvePlanExit(message.toolUseId) },
                colors = ButtonDefaults.buttonColors(containerColor = AccentGreen)
            ) {
                Icon(
                    Icons.Default.Check,
                    contentDescription = null,
                    modifier = Modifier.size(16.dp)
                )
                Spacer(modifier = Modifier.width(4.dp))
                Text("Approve")
            }
        }
    }
}

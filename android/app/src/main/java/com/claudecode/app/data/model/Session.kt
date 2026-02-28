package com.claudecode.app.data.model

data class Session(
    val id: String,
    val status: SessionStatus,
    val createdAt: Double,
    val lastActiveAt: Double? = null,
    val workingDirectory: String,
    val pid: Int? = null,
    val totalCostUsd: Double? = null,
    val title: String? = null,
    val description: String? = null,
    val teamId: String? = null,
    val lastUserMessageAt: Double? = null,
    val lastAssistantMessageAt: Double? = null
)

enum class SessionStatus {
    Starting,
    Ready,
    Busy,
    WaitingForInput,
    Dead,
    Destroyed;

    companion object {
        fun fromString(value: String): SessionStatus = when (value) {
            "starting" -> Starting
            "ready" -> Ready
            "busy" -> Busy
            "waiting_for_input" -> WaitingForInput
            "dead" -> Dead
            "destroyed" -> Destroyed
            else -> Dead
        }
    }
}

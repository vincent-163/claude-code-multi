package com.claudecode.app.data.model

data class Session(
    val id: String,
    val status: SessionStatus,
    val createdAt: Double,
    val lastActiveAt: Double? = null,
    val workingDirectory: String,
    val pid: Int? = null,
    val totalCostUsd: Double? = null
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

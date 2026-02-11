package com.claudecode.app.network

import com.claudecode.app.data.model.Session
import com.claudecode.app.data.model.SessionStatus
import com.google.gson.Gson
import com.google.gson.JsonArray
import com.google.gson.JsonObject
import com.google.gson.annotations.SerializedName
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

class ApiClient {

    @Volatile
    private var baseUrl: String = "http://127.0.0.1:8080"

    @Volatile
    var authToken: String? = null

    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.SECONDS) // No read timeout for SSE
        .writeTimeout(30, TimeUnit.SECONDS)
        .build()

    private val shortClient = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .build()

    private val gson = Gson()
    private val jsonMediaType = "application/json; charset=utf-8".toMediaType()

    fun updateBaseUrl(port: Int) {
        baseUrl = "http://127.0.0.1:$port"
    }

    fun updateBaseUrlDirect(url: String) {
        baseUrl = url
    }

    private fun authHeader(builder: Request.Builder): Request.Builder {
        authToken?.let { builder.addHeader("Authorization", "Bearer $it") }
        return builder
    }

    suspend fun healthCheck(): Result<HealthResponse> = withContext(Dispatchers.IO) {
        try {
            val request = Request.Builder()
                .url("$baseUrl/health")
                .get()
                .build()

            val response = shortClient.newCall(request).execute()
            if (!response.isSuccessful) {
                return@withContext Result.failure(
                    RuntimeException("HTTP ${response.code}: ${response.message}")
                )
            }

            val body = response.body?.string() ?: "{}"
            Result.success(gson.fromJson(body, HealthResponse::class.java))
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun listSessions(): Result<List<Session>> = withContext(Dispatchers.IO) {
        try {
            val request = authHeader(
                Request.Builder()
                    .url("$baseUrl/sessions")
                    .get()
            ).build()

            val response = shortClient.newCall(request).execute()
            if (!response.isSuccessful) {
                return@withContext Result.failure(
                    RuntimeException("HTTP ${response.code}: ${response.message}")
                )
            }

            val body = response.body?.string() ?: """{"sessions":[]}"""
            val listResponse = gson.fromJson(body, SessionListResponse::class.java)
            Result.success(listResponse.sessions.map { it.toSession() })
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun createSession(
        workingDirectory: String? = null,
        model: String? = null,
        resumeConversationId: String? = null,
        permissionMode: String? = null,
        systemPrompt: String? = null,
        additionalFlags: List<String>? = null,
        dangerouslySkipPermissions: Boolean = false
    ): Result<Session> = withContext(Dispatchers.IO) {
        try {
            val payload = JsonObject().apply {
                workingDirectory?.let { addProperty("working_directory", it) }
                model?.let { addProperty("model", it) }
                resumeConversationId?.let { addProperty("resume_conversation_id", it) }
                permissionMode?.let { addProperty("permission_mode", it) }
                systemPrompt?.let { addProperty("system_prompt", it) }
                if (dangerouslySkipPermissions) {
                    addProperty("dangerously_skip_permissions", true)
                }
                additionalFlags?.let { flags ->
                    val arr = JsonArray()
                    flags.forEach { arr.add(it) }
                    add("additional_flags", arr)
                }
            }
            val request = authHeader(
                Request.Builder()
                    .url("$baseUrl/sessions")
                    .post(gson.toJson(payload).toRequestBody(jsonMediaType))
            ).build()

            val response = shortClient.newCall(request).execute()
            if (!response.isSuccessful) {
                return@withContext Result.failure(
                    RuntimeException("HTTP ${response.code}: ${response.message}")
                )
            }

            val body = response.body?.string() ?: "{}"
            val session = gson.fromJson(body, SessionResponse::class.java)
            Result.success(session.toSession())
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun getSession(sessionId: String, historyLines: Int = 1000): Result<SessionDetailResponse> =
        withContext(Dispatchers.IO) {
            try {
                val request = authHeader(
                    Request.Builder()
                        .url("$baseUrl/sessions/$sessionId?history_lines=$historyLines")
                        .get()
                ).build()

                val response = shortClient.newCall(request).execute()
                if (!response.isSuccessful) {
                    return@withContext Result.failure(
                        RuntimeException("HTTP ${response.code}: ${response.message}")
                    )
                }

                val body = response.body?.string() ?: "{}"
                val jsonObj = com.google.gson.JsonParser.parseString(body).asJsonObject
                val base = gson.fromJson(body, SessionDetailResponse::class.java)

                // Parse history as raw JsonObjects for event replay
                val historyArray = jsonObj.getAsJsonArray("history")
                val rawHistory = historyArray?.map { it.asJsonObject } ?: emptyList()
                Result.success(base.copy(rawHistory = rawHistory))
            } catch (e: Exception) {
                Result.failure(e)
            }
        }

    suspend fun sendInput(
        sessionId: String,
        type: String,
        content: String? = null
    ): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            val payload = JsonObject().apply {
                addProperty("type", type)
                content?.let { addProperty("content", it) }
            }
            val request = authHeader(
                Request.Builder()
                    .url("$baseUrl/sessions/$sessionId/input")
                    .post(gson.toJson(payload).toRequestBody(jsonMediaType))
            ).build()

            val response = shortClient.newCall(request).execute()
            if (!response.isSuccessful) {
                return@withContext Result.failure(
                    RuntimeException("HTTP ${response.code}: ${response.message}")
                )
            }
            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun sendControlResponse(
        sessionId: String,
        requestId: String,
        approved: Boolean,
        toolInput: Map<String, Any>? = null
    ): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            val responseObj = JsonObject().apply {
                addProperty("subtype", "success")
                addProperty("request_id", requestId)
                if (approved) {
                    val inner = JsonObject().apply {
                        addProperty("behavior", "allow")
                        toolInput?.let { input ->
                            add("updatedInput", gson.toJsonTree(input))
                        }
                    }
                    add("response", inner)
                } else {
                    val inner = JsonObject().apply {
                        addProperty("behavior", "deny")
                        addProperty("message", "User denied permission")
                    }
                    add("response", inner)
                }
            }
            val payload = JsonObject().apply {
                addProperty("type", "control_response")
                add("response", responseObj)
            }
            val request = authHeader(
                Request.Builder()
                    .url("$baseUrl/sessions/$sessionId/input")
                    .post(gson.toJson(payload).toRequestBody(jsonMediaType))
            ).build()

            val response = shortClient.newCall(request).execute()
            if (!response.isSuccessful) {
                return@withContext Result.failure(
                    RuntimeException("HTTP ${response.code}: ${response.message}")
                )
            }
            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun deleteSession(sessionId: String): Result<Unit> = withContext(Dispatchers.IO) {
        try {
            val request = authHeader(
                Request.Builder()
                    .url("$baseUrl/sessions/$sessionId")
                    .delete()
            ).build()

            val response = shortClient.newCall(request).execute()
            if (!response.isSuccessful) {
                return@withContext Result.failure(
                    RuntimeException("HTTP ${response.code}: ${response.message}")
                )
            }
            Result.success(Unit)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    fun getStreamUrl(sessionId: String): String {
        return "$baseUrl/sessions/$sessionId/stream"
    }

    fun getSseClient(): SseClient = SseClient(client, authToken)
}

data class HealthResponse(
    val status: String,
    val version: String?,
    @SerializedName("sessions_active") val sessionsActive: Int,
    @SerializedName("uptime_seconds") val uptimeSeconds: Long
)

private data class SessionListResponse(
    val sessions: List<SessionResponse>
)

private data class SessionResponse(
    val id: String,
    val status: String?,
    @SerializedName("created_at") val createdAt: Double?,
    @SerializedName("last_active_at") val lastActiveAt: Double?,
    @SerializedName("working_directory") val workingDirectory: String?,
    val pid: Int?,
    @SerializedName("total_cost_usd") val totalCostUsd: Double?
) {
    fun toSession() = Session(
        id = id,
        status = SessionStatus.fromString(status ?: "dead"),
        createdAt = createdAt ?: 0.0,
        lastActiveAt = lastActiveAt,
        workingDirectory = workingDirectory ?: "",
        pid = pid,
        totalCostUsd = totalCostUsd
    )
}

data class SessionDetailResponse(
    val id: String,
    val status: String?,
    @SerializedName("created_at") val createdAt: Double?,
    @SerializedName("last_active_at") val lastActiveAt: Double?,
    @SerializedName("working_directory") val workingDirectory: String?,
    val pid: Int?,
    @SerializedName("total_cost_usd") val totalCostUsd: Double?,
    val history: List<Map<String, Any>>?,
    @Transient val rawHistory: List<JsonObject> = emptyList()
) {
    fun toSession() = Session(
        id = id,
        status = SessionStatus.fromString(status ?: "dead"),
        createdAt = createdAt ?: 0.0,
        lastActiveAt = lastActiveAt,
        workingDirectory = workingDirectory ?: "",
        pid = pid,
        totalCostUsd = totalCostUsd
    )
}

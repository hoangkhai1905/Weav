package com.weav.workspace.domain.valueobject;

public enum ConnectionProvider {
    GMAIL,
    GOOGLE_SHEETS,
    TELEGRAM,
    HTTP,
    GOOGLE_CALENDAR,
    GOOGLE_DRIVE,
    DISCORD,
    SLACK,
    TEAMS,
    OPENAI,
    ANTHROPIC,
    GEMINI;

    /** True for AI providers connected with the workspace's own API key. */
    public boolean isLlmKey() {
        return this == OPENAI || this == ANTHROPIC || this == GEMINI;
    }

    /** True for providers connected through the shared Google OAuth flow. */
    public boolean isGoogleOAuth() {
        return this == GMAIL || this == GOOGLE_SHEETS || this == GOOGLE_CALENDAR || this == GOOGLE_DRIVE;
    }
}
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
    TEAMS;

    /** True for providers connected through the shared Google OAuth flow. */
    public boolean isGoogleOAuth() {
        return this == GMAIL || this == GOOGLE_SHEETS || this == GOOGLE_CALENDAR || this == GOOGLE_DRIVE;
    }
}
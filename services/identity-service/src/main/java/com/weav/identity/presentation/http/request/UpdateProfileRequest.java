package com.weav.identity.presentation.http.request;

/**
 * Keeps JSON null distinct from a missing member: null clears displayName,
 * while a missing member is rejected by the controller.
 */
public final class UpdateProfileRequest {

    private boolean displayNamePresent;
    private String displayName;

    public UpdateProfileRequest() {
    }

    public void setDisplayName(String displayName) {
        this.displayNamePresent = true;
        this.displayName = displayName;
    }

    public String displayName() {
        return displayName;
    }

    public boolean hasDisplayName() {
        return displayNamePresent;
    }
}

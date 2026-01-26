export interface RegistrationRequest {
    email: string;
    first_name: string;
    last_name: string;
    password: string;
}

export interface LoginRequest {
    email: string;
    password: string;
}

export interface TokenResponse {
    access: string;
    refresh: string;
}

export interface ApiMessageResponse {
    detail: string;
}

export interface EmailTokenRequest {
    token: string;
}

export interface PasswordResetRequest {
    email: string;
}

export interface PasswordResetPayload {
    token: string;
    password: string;
}

export interface InviteCompletionPayload {
    token: string;
    password: string;
}

export interface ProfileResponse {
    id: string;
    email: string;
    first_name: string;
    last_name: string;
    is_verified: boolean;
    date_joined: string;
}

export interface ProfileUpdatePayload {
    first_name?: string;
    last_name?: string;
}

export interface ChangePasswordPayload {
    old_password: string;
    new_password: string;
}

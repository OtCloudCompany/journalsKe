import { Routes } from '@angular/router';

import { InviteCompleteComponent } from './invite-complete/invite-complete.component';
import { LoginComponent } from './login/login.component';
import { PasswordResetCompleteComponent } from './password-reset-complete/password-reset-complete.component';
import { PasswordResetRequestComponent } from './password-reset-request/password-reset-request.component';
import { RegisterComponent } from './register/register.component';
import { VerifyEmailComponent } from './verify-email/verify-email.component';

export const AUTH_FEATURE_ROUTES: Routes = [
    { path: '', pathMatch: 'full', redirectTo: 'login' },
    { path: 'login', component: LoginComponent },
    { path: 'register', component: RegisterComponent },
    { path: 'verify-email', component: VerifyEmailComponent },
    { path: 'password/forgot', component: PasswordResetRequestComponent },
    { path: 'password/reset', component: PasswordResetCompleteComponent },
    { path: 'invite/complete', component: InviteCompleteComponent }
];

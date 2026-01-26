import { NgIf } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { AuthStateService } from '../../../core/services/auth-state.service';

@Component({
    selector: 'app-verify-email',
    standalone: true,
    imports: [NgIf, RouterLink, ReactiveFormsModule],
    templateUrl: './verify-email.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class VerifyEmailComponent implements OnInit {
    private readonly authState = inject(AuthStateService);
    private readonly route = inject(ActivatedRoute);
    private readonly formBuilder = inject(FormBuilder);

    readonly verifying = signal(false);
    readonly successMessage = signal<string | null>(null);
    readonly errorMessage = signal<string | null>(null);
    readonly token = signal<string | null>(null);

    readonly resendForm = this.formBuilder.nonNullable.group({
        email: ['', [Validators.required, Validators.email]]
    });

    ngOnInit(): void {
        const token = this.route.snapshot.queryParamMap.get('token');
        this.token.set(token);
        if (token) {
            this.handleVerification(token);
        }
    }

    handleVerification(token: string): void {
        if (this.verifying()) {
            return;
        }
        if (!token) {
            this.errorMessage.set('Missing verification token. Use the link from your email.');
            return;
        }
        this.verifying.set(true);
        this.successMessage.set(null);
        this.errorMessage.set(null);

        this.authState.verifyEmail(token).subscribe({
            next: (response) => {
                this.verifying.set(false);
                this.successMessage.set(response.detail ?? 'Email verified. You can now sign in.');
            },
            error: (error) => {
                this.verifying.set(false);
                const detail = error?.error?.detail ?? 'Verification failed. Request a new link.';
                this.errorMessage.set(detail);
            }
        });
    }

    resendVerification(): void {
        if (this.resendForm.invalid) {
            return;
        }
        const { email } = this.resendForm.getRawValue();
        this.verifying.set(true);
        this.successMessage.set(null);
        this.errorMessage.set(null);
        this.authState.resendVerification(email).subscribe({
            next: (response) => {
                this.verifying.set(false);
                this.successMessage.set(response.detail ?? 'Verification email sent. Check your inbox.');
                this.resendForm.reset();
            },
            error: (error) => {
                this.verifying.set(false);
                const detail = error?.error?.detail ?? 'Could not resend verification email.';
                this.errorMessage.set(detail);
            }
        });
    }
}

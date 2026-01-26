import { NgIf } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { AuthStateService } from '../../../core/services/auth-state.service';

@Component({
    selector: 'app-password-reset-request',
    standalone: true,
    imports: [ReactiveFormsModule, NgIf, RouterLink],
    templateUrl: './password-reset-request.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class PasswordResetRequestComponent {
    private readonly formBuilder = inject(FormBuilder);
    private readonly authState = inject(AuthStateService);

    readonly submitting = signal(false);
    readonly successMessage = signal<string | null>(null);
    readonly errorMessage = signal<string | null>(null);

    readonly form = this.formBuilder.nonNullable.group({
        email: ['', [Validators.required, Validators.email]]
    });

    submit(): void {
        if (this.form.invalid || this.submitting()) {
            return;
        }
        this.submitting.set(true);
        this.successMessage.set(null);
        this.errorMessage.set(null);

        const { email } = this.form.getRawValue();
        this.authState.requestPasswordReset(email).subscribe({
            next: (response) => {
                this.submitting.set(false);
                this.successMessage.set(response.detail ?? 'Password reset link sent. Check your inbox.');
                this.form.reset();
            },
            error: (error) => {
                this.submitting.set(false);
                const detail = error?.error?.detail ?? 'Unable to send reset email.';
                this.errorMessage.set(detail);
            }
        });
    }
}

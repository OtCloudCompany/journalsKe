import { NgIf } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { AuthStateService } from '../../../core/services/auth-state.service';

@Component({
    selector: 'app-password-reset-complete',
    standalone: true,
    imports: [ReactiveFormsModule, NgIf, RouterLink],
    templateUrl: './password-reset-complete.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class PasswordResetCompleteComponent implements OnInit {
    private readonly formBuilder = inject(FormBuilder);
    private readonly authState = inject(AuthStateService);
    private readonly route = inject(ActivatedRoute);

    readonly submitting = signal(false);
    readonly successMessage = signal<string | null>(null);
    readonly errorMessage = signal<string | null>(null);
    readonly token = signal<string | null>(null);

    readonly form = this.formBuilder.nonNullable.group({
        password: ['', [Validators.required, Validators.minLength(8)]],
        confirmPassword: ['', [Validators.required]]
    }, { validators: (control) => this.passwordsMatch(control) });

    ngOnInit(): void {
        const token = this.route.snapshot.queryParamMap.get('token');
        this.token.set(token);
    }

    submit(): void {
        if (this.form.invalid || this.submitting()) {
            return;
        }
        const token = this.token();
        if (!token) {
            this.errorMessage.set('Missing reset token. Request a new link.');
            return;
        }

        this.submitting.set(true);
        this.successMessage.set(null);
        this.errorMessage.set(null);

        const { password } = this.form.getRawValue();
        this.authState.resetPassword(token, password).subscribe({
            next: (response) => {
                this.submitting.set(false);
                this.successMessage.set(response.detail ?? 'Password updated. You can now sign in.');
                this.form.reset();
            },
            error: (error) => {
                this.submitting.set(false);
                const detail = error?.error?.detail ?? 'Unable to reset password. Request a new link.';
                this.errorMessage.set(detail);
            }
        });
    }

    private passwordsMatch(control: AbstractControl): ValidationErrors | null {
        const password = control.get('password');
        const confirm = control.get('confirmPassword');
        if (!password || !confirm) {
            return null;
        }
        const mismatch = password.value && confirm.value && password.value !== confirm.value;
        if (mismatch) {
            confirm.setErrors({ ...(confirm.errors ?? {}), mismatch: true });
            return { mismatch: true };
        }
        if (confirm.hasError('mismatch')) {
            const { mismatch: _removed, ...rest } = confirm.errors ?? {};
            confirm.setErrors(Object.keys(rest).length ? rest : null);
        }
        return null;
    }
}

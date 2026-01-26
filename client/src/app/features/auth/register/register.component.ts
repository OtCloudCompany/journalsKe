import { NgIf } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { AbstractControl, FormBuilder, ValidationErrors, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { AuthStateService } from '../../../core/services/auth-state.service';

@Component({
    selector: 'app-register',
    standalone: true,
    imports: [ReactiveFormsModule, RouterLink, NgIf],
    templateUrl: './register.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class RegisterComponent {
    private readonly formBuilder = inject(FormBuilder);
    private readonly authState = inject(AuthStateService);

    readonly submitting = signal(false);
    readonly successMessage = signal<string | null>(null);
    readonly errorMessage = signal<string | null>(null);

    readonly form = this.formBuilder.nonNullable.group({
        email: ['', [Validators.required, Validators.email]],
        firstName: ['', [Validators.required, Validators.minLength(2)]],
        lastName: ['', [Validators.required, Validators.minLength(2)]],
        password: ['', [Validators.required, Validators.minLength(8)]],
        confirmPassword: ['', [Validators.required]]
    }, { validators: (control) => this.passwordsMatch(control) });

    submit(): void {
        if (this.form.invalid || this.submitting()) {
            return;
        }

        this.submitting.set(true);
        this.errorMessage.set(null);

        const { email, firstName, lastName, password } = this.form.getRawValue();

        this.authState.register({
            email,
            first_name: firstName,
            last_name: lastName,
            password
        }).subscribe({
            next: (response) => {
                this.submitting.set(false);
                this.successMessage.set(response.detail ?? 'Account created. Check your email to verify your address.');
                this.form.reset();
            },
            error: (error) => {
                this.submitting.set(false);
                const detail = error?.error?.detail ?? 'Could not complete registration. Try again later.';
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

import { AsyncPipe, NgIf } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { AuthStateService } from '../../../core/services/auth-state.service';

@Component({
    selector: 'app-login',
    standalone: true,
    imports: [ReactiveFormsModule, RouterLink, NgIf],
    templateUrl: './login.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class LoginComponent implements OnInit {
    private readonly formBuilder = inject(FormBuilder);
    private readonly authState = inject(AuthStateService);
    private readonly router = inject(Router);
    private readonly route = inject(ActivatedRoute);

    readonly submitting = signal(false);
    readonly errorMessage = signal<string | null>(null);

    readonly form = this.formBuilder.nonNullable.group({
        email: ['', [Validators.required, Validators.email]],
        password: ['', [Validators.required, Validators.minLength(8)]]
    });

    ngOnInit(): void {
        const email = this.route.snapshot.queryParamMap.get('email');
        if (email) {
            this.form.patchValue({ email });
        }
    }

    submit(): void {
        if (this.form.invalid || this.submitting()) {
            return;
        }

        this.submitting.set(true);
        this.errorMessage.set(null);

        const { email, password } = this.form.getRawValue();

        this.authState.login(email, password).subscribe({
            next: async () => {
                this.submitting.set(false);
                const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
                if (returnUrl) {
                    await this.router.navigateByUrl(returnUrl);
                } else {
                    await this.router.navigate(['/']);
                }
            },
            error: (error) => {
                this.submitting.set(false);
                const detail = error?.error?.detail ?? 'Could not sign in. Double-check your email and password.';
                this.errorMessage.set(detail);
            }
        });
    }
}

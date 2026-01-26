import { NgIf } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, effect, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { AuthStateService } from '../../../core/services/auth-state.service';
import { ProfileResponse } from '../../../core/models/auth.models';

@Component({
    selector: 'app-profile',
    standalone: true,
    imports: [ReactiveFormsModule, NgIf, RouterLink, DatePipe],
    templateUrl: './profile.component.html',
    styleUrl: './profile.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class ProfileComponent implements OnInit {
    private readonly formBuilder = inject(FormBuilder);
    private readonly authState = inject(AuthStateService);
    private readonly platformId = inject(PLATFORM_ID);

    readonly profileSignal = signal<ProfileResponse | null>(this.authState.profile);

    readonly loadingProfile = signal(!this.authState.profile);
    readonly saving = signal(false);
    readonly passwordResetting = signal(false);
    readonly deleting = signal(false);
    readonly successMessage = signal<string | null>(null);
    readonly errorMessage = signal<string | null>(null);

    readonly form = this.formBuilder.nonNullable.group({
        firstName: ['', [Validators.maxLength(150)]],
        lastName: ['', [Validators.maxLength(150)]]
    });

    private readonly isBrowser = isPlatformBrowser(this.platformId);

    constructor() {
        this.authState.profile$
            .pipe(takeUntilDestroyed())
            .subscribe(profile => {
                this.profileSignal.set(profile);
            });

        effect(() => {
            const profile = this.profileSignal();
            if (profile) {
                this.form.patchValue({
                    firstName: profile.first_name ?? '',
                    lastName: profile.last_name ?? ''
                }, { emitEvent: false });
                this.loadingProfile.set(false);
            }
        });
    }

    ngOnInit(): void {
        if (!this.profileSignal()) {
            this.authState.loadProfile(true).pipe(takeUntilDestroyed()).subscribe({
                next: () => {
                    this.loadingProfile.set(false);
                },
                error: (err) => {
                    const detail = err?.error?.detail ?? 'Unable to load profile.';
                    this.errorMessage.set(detail);
                    this.loadingProfile.set(false);
                }
            });
        }
    }

    get profileData(): ProfileResponse | null {
        return this.profileSignal();
    }

    submit(): void {
        if (this.form.invalid || this.saving()) {
            this.form.markAllAsTouched();
            return;
        }
        this.saving.set(true);
        this.successMessage.set(null);
        this.errorMessage.set(null);

        const payload = {
            first_name: (this.form.controls.firstName.value || '').trim() || undefined,
            last_name: (this.form.controls.lastName.value || '').trim() || undefined
        };

        this.authState.updateProfile(payload).subscribe({
            next: (profile) => {
                this.saving.set(false);
                this.profileSignal.set(profile);
                this.successMessage.set('Profile updated successfully.');
            },
            error: (err) => {
                this.saving.set(false);
                const detail = err?.error?.detail ?? 'Unable to update profile.';
                this.errorMessage.set(detail);
            }
        });
    }

    triggerPasswordReset(): void {
        const profile = this.profileSignal();
        if (!profile || this.passwordResetting()) {
            return;
        }
        this.passwordResetting.set(true);
        this.successMessage.set(null);
        this.errorMessage.set(null);

        this.authState.requestPasswordReset(profile.email).subscribe({
            next: (response) => {
                this.passwordResetting.set(false);
                this.successMessage.set(response.detail ?? 'Password reset email sent.');
            },
            error: (err) => {
                this.passwordResetting.set(false);
                const detail = err?.error?.detail ?? 'Unable to send password reset email.';
                this.errorMessage.set(detail);
            }
        });
    }

    deleteAccount(): void {
        if (!this.isBrowser || this.deleting()) {
            return;
        }
        const profile = this.profileSignal();
        if (!profile) {
            return;
        }
        const confirmed = window.confirm('Delete your account? This action cannot be undone.');
        if (!confirmed) {
            return;
        }
        this.deleting.set(true);
        this.successMessage.set(null);
        this.errorMessage.set(null);

        this.authState.deleteAccount().subscribe({
            next: (response) => {
                this.deleting.set(false);
                const message = response.detail ?? 'Account deleted.';
                if (this.isBrowser) {
                    window.alert(message);
                }
                this.authState.logout();
            },
            error: (err) => {
                this.deleting.set(false);
                const detail = err?.error?.detail ?? 'Unable to delete account.';
                this.errorMessage.set(detail);
            }
        });
    }
}

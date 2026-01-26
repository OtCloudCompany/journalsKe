import { NgIf } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { ResearcherApiService } from '../../../core/services/researcher-api.service';

@Component({
    selector: 'app-researcher-verify-email',
    standalone: true,
    imports: [NgIf, RouterLink],
    templateUrl: './researcher-verify-email.component.html',
    styleUrl: './researcher-verify-email.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class ResearcherVerifyEmailComponent implements OnInit {
    private readonly route = inject(ActivatedRoute);
    private readonly researcherApi = inject(ResearcherApiService);
    private readonly destroyRef = inject(DestroyRef);

    readonly verifying = signal(true);
    readonly success = signal(false);
    readonly message = signal<string>('Verifying your institutional email…');

    ngOnInit(): void {
        this.route.queryParamMap
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(params => {
                const token = params.get('token');
                if (!token) {
                    this.verifying.set(false);
                    this.success.set(false);
                    this.message.set('Verification token is missing.');
                    return;
                }
                this.verifyToken(token);
            });
    }

    private verifyToken(token: string): void {
        this.verifying.set(true);
        this.success.set(false);
        this.message.set('Verifying your institutional email…');

        this.researcherApi.verifyInstitutionalEmail(token).subscribe({
            next: (response) => {
                this.verifying.set(false);
                this.success.set(true);
                this.message.set(response.detail || 'Institutional email verified.');
            },
            error: (err) => {
                const detail = err?.error?.token ?? err?.error?.detail ?? 'Verification failed or token has expired.';
                this.verifying.set(false);
                this.success.set(false);
                this.message.set(detail);
            }
        });
    }
}

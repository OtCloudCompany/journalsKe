import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';

import { AuthStateService } from '../../core/services/auth-state.service';

@Component({
    selector: 'app-site-header',
    standalone: true,
    imports: [RouterLink, RouterLinkActive, DatePipe],
    templateUrl: './site-header.component.html',
    styleUrl: './site-header.component.scss'
})
export class SiteHeaderComponent {
    private readonly authState = inject(AuthStateService);
    private readonly profileSource = toSignal(this.authState.profile$, { initialValue: null });

    protected readonly brand = {
        name: 'KeJOL',
        tagline: 'Academic Journals in Kenya'
    };

    protected readonly primaryNav = signal([
        { label: 'Home', path: '/', exact: true },
        { label: 'Journals', path: '/journals' },
        { label: 'Publications', path: '/publications' },
        { label: 'Researchers', path: '/researchers' },
    ]);

    protected readonly isAuthenticated = computed(() => this.authState.isAuthenticated);
    protected readonly profile = computed(() => this.profileSource());

    protected logout(): void {
        this.authState.logout();
    }
}

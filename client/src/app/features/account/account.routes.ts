import { Routes } from '@angular/router';

import { ProfileComponent } from './profile/profile.component';
import { authGuard } from '../../core/guards/auth.guard';

export const ACCOUNT_ROUTES: Routes = [
    {
        path: '',
        pathMatch: 'full',
        redirectTo: 'profile'
    },
    {
        path: 'profile',
        component: ProfileComponent,
        canActivate: [authGuard],
        title: 'Your Profile'
    }
];

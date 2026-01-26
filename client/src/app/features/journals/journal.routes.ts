import { Routes } from '@angular/router';

import { JournalDetailComponent } from './journal-detail/journal-detail.component';
import { JournalFormComponent } from './journal-form/journal-form.component';
import { JournalListComponent } from './journal-list/journal-list.component';
import { authGuard } from '../../core/guards/auth.guard';

export const JOURNAL_ROUTES: Routes = [
    { path: '', component: JournalListComponent, title: 'Journals' },
    { path: 'new', component: JournalFormComponent, canActivate: [authGuard], title: 'Create Journal' },
    { path: ':slug', component: JournalDetailComponent, title: 'Journal Details' },
    { path: ':slug/edit', component: JournalFormComponent, canActivate: [authGuard], title: 'Edit Journal' }
];

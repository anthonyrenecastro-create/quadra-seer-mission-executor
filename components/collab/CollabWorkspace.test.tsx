// components/collab/CollabWorkspace.test.tsx
// Verifies the workspace shell renders the mission switcher and all 7 tabs
// with the service layer mocked (no backend required).

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import CollabWorkspace from './CollabWorkspace';

vi.mock('../../services/collabService', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../services/collabService')>();
  return {
    ...mod,
    getHealth: vi.fn().mockResolvedValue({
      ok: true,
      schemaVersion: 1,
      authMode: 'disabled',
      python: false,
      hrm: false,
    }),
    listMissions: vi.fn().mockResolvedValue([
      {
        id: 'msn_test1',
        title: 'Test Mission',
        objective: 'Verify the workspace',
        description: '',
        owner: 'local-owner',
        contributors: [{ actor: 'local-owner', role: 'owner' }],
        constraints: { budget: '', time: '', resources: '', permissions: '' },
        milestones: [],
        tasks: [],
        successMeasures: [],
        status: 'active',
        createdAt: '2026-10-06T00:00:00Z',
        updatedAt: '2026-10-06T00:00:00Z',
        version: 1,
        history: [],
      },
    ]),
    getDashboard: vi.fn().mockResolvedValue({
      mission: {
        id: 'msn_test1',
        title: 'Test Mission',
        objective: 'Verify the workspace',
        description: '',
        owner: 'local-owner',
        contributors: [{ actor: 'local-owner', role: 'owner' }],
        constraints: { budget: '', time: '', resources: '', permissions: '' },
        milestones: [],
        tasks: [],
        successMeasures: [],
        status: 'active',
        createdAt: '2026-10-06T00:00:00Z',
        updatedAt: '2026-10-06T00:00:00Z',
        version: 1,
        history: [],
      },
      progress: { milestonesDone: 0, milestonesTotal: 0, tasksDone: 0, tasksTotal: 0 },
      unresolvedQuestions: [],
      upcomingMilestones: [],
      experimentsAwaitingResults: [],
    }),
  };
});

describe('CollabWorkspace', () => {
  it('renders the mission switcher and all 7 tabs', async () => {
    render(<CollabWorkspace />);

    await waitFor(() => {
      expect(screen.getByLabelText('Mission')).toBeTruthy();
    });

    for (const tab of ['Overview', 'Evidence', 'Branches', 'Experiments', 'Exchange', 'Agents', 'Activity']) {
      expect(screen.getByRole('button', { name: tab })).toBeTruthy();
    }

    // Health badge reflects the mocked healthy backend
    expect(screen.getByText('Backend connected')).toBeTruthy();
    // HRM honestly reported unavailable
    expect(screen.getByText('HRM unavailable')).toBeTruthy();
  });

  it('shows the empty state when no missions exist', async () => {
    const svc = await import('../../services/collabService');
    vi.mocked(svc.listMissions).mockResolvedValueOnce([]);

    render(<CollabWorkspace />);

    await waitFor(() => {
      expect(screen.getByText('No mission selected')).toBeTruthy();
    });
    expect(screen.getAllByText('Load demo mission').length).toBeGreaterThan(0);
  });
});

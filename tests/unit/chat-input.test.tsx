import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ChatInput } from '@/pages/Chat/ChatInput';

const { agentsState, chatState, gatewayState, skillsState, providersState } = vi.hoisted(() => ({
  agentsState: {
    agents: [] as Array<Record<string, unknown>>,
    updateAgentModel: vi.fn(async () => undefined),
    defaultModelRef: null as string | null,
  },
  chatState: {
    currentAgentId: 'main',
  },
  gatewayState: {
    status: { state: 'running', port: 18789 },
  },
  skillsState: {
    skills: [] as Array<Record<string, unknown>>,
    fetchSkills: vi.fn(async () => undefined),
  },
  providersState: {
    accounts: [] as Array<Record<string, unknown>>,
    statuses: [] as Array<Record<string, unknown>>,
    defaultAccountId: null as string | null,
    refreshProviderSnapshot: vi.fn(async () => undefined),
  },
}));

vi.mock('@/stores/agents', () => ({
  useAgentsStore: (selector: (state: typeof agentsState) => unknown) => selector(agentsState),
}));

vi.mock('@/stores/chat', () => ({
  useChatStore: (selector: (state: typeof chatState) => unknown) => selector(chatState),
}));

vi.mock('@/stores/gateway', () => ({
  useGatewayStore: (selector: (state: typeof gatewayState) => unknown) => selector(gatewayState),
}));

vi.mock('@/stores/skills', () => ({
  useSkillsStore: (selector: (state: typeof skillsState) => unknown) => selector(skillsState),
}));

vi.mock('@/stores/providers', () => ({
  useProviderStore: (selector: (state: typeof providersState) => unknown) =>
    selector(providersState),
}));

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: vi.fn(),
}));

vi.mock('@/lib/api-client', () => ({
  invokeIpc: vi.fn(),
}));

function translate(key: string, vars?: Record<string, unknown>): string {
  switch (key) {
    case 'composer.attachFiles':
      return 'Attach files';
    case 'composer.pickAgent':
      return 'Choose agent';
    case 'composer.agentSelectorLabel':
      return `Chat agent: ${String(vars?.agent ?? '')}`;
    case 'composer.clearTarget':
      return 'Clear target agent';
    case 'composer.targetChip':
      return `@${String(vars?.agent ?? '')}`;
    case 'composer.agentPickerTitle':
      return 'Choose which agent should receive the next message';
    case 'composer.currentAgentOption':
      return `Current agent: ${String(vars?.agent ?? '')}`;
    case 'composer.currentAgentOptionDesc':
      return 'Send to the agent for the active chat session';
    case 'composer.gatewayDisconnectedPlaceholder':
      return 'Gateway not connected...';
    case 'composer.send':
      return 'Send';
    case 'composer.stop':
      return 'Stop';
    case 'composer.gatewayConnected':
      return 'connected';
    case 'composer.gatewayStatus':
      return `gateway ${String(vars?.state ?? '')} | port: ${String(vars?.port ?? '')} ${String(vars?.pid ?? '')}`.trim();
    case 'composer.retryFailedAttachments':
      return 'Retry failed attachments';
    default:
      return key;
  }
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: translate,
  }),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

describe('ChatInput agent targeting', () => {
  beforeEach(() => {
    agentsState.agents = [];
    chatState.currentAgentId = 'main';
    gatewayState.status = { state: 'running', port: 18789 };
    agentsState.defaultModelRef = null;
    agentsState.updateAgentModel.mockClear();
    skillsState.skills = [];
    skillsState.fetchSkills.mockClear();
    providersState.accounts = [];
    providersState.statuses = [];
    providersState.defaultAccountId = null;
    providersState.refreshProviderSnapshot.mockClear();
  });

  it('shows current agent in picker when only one agent is configured', () => {
    agentsState.agents = [
      {
        id: 'main',
        name: 'Main',
        isDefault: true,
        modelDisplay: 'MiniMax',
        inheritedModel: true,
        workspace: '~/.boostclaw/openclaw/workspace',
        agentDir: '~/.boostclaw/openclaw/agents/main/agent',
        mainSessionKey: 'agent:main:main',
        channelTypes: [],
      },
    ];

    render(<ChatInput onSend={vi.fn()} />);

    expect(screen.getByTitle('Choose agent')).toBeInTheDocument();
    expect(screen.getByTestId('chat-agent-picker-button')).toHaveTextContent('Main');
  });

  it('lets the user select an agent target and sends it with the message', () => {
    const onSend = vi.fn();
    agentsState.agents = [
      {
        id: 'main',
        name: 'Main',
        isDefault: true,
        modelDisplay: 'MiniMax',
        inheritedModel: true,
        workspace: '~/.boostclaw/openclaw/workspace',
        agentDir: '~/.boostclaw/openclaw/agents/main/agent',
        mainSessionKey: 'agent:main:main',
        channelTypes: [],
      },
      {
        id: 'research',
        name: 'Research',
        isDefault: false,
        modelDisplay: 'Claude',
        inheritedModel: false,
        workspace: '~/.boostclaw/openclaw/workspace-research',
        agentDir: '~/.boostclaw/openclaw/agents/research/agent',
        mainSessionKey: 'agent:research:desk',
        channelTypes: [],
      },
    ];

    render(<ChatInput onSend={onSend} />);

    expect(screen.getByTestId('chat-agent-picker-button')).toHaveTextContent('Main');

    fireEvent.click(screen.getByTitle('Choose agent'));
    fireEvent.click(screen.getByText('Research'));

    expect(screen.getByText('@Research')).toBeInTheDocument();
    expect(screen.getByTestId('chat-agent-picker-button')).toHaveTextContent('Research');

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Hello direct agent' } });
    fireEvent.click(screen.getByTitle('Send'));

    expect(onSend).toHaveBeenCalledWith('Hello direct agent', undefined, 'research');
  });

  it('shows a skill chip after selecting a skill', () => {
    skillsState.skills = [
      {
        id: 'sql-toolkit',
        name: 'SQL Toolkit',
        description: 'Query helper',
        enabled: true,
      },
    ];

    render(<ChatInput onSend={vi.fn()} />);

    fireEvent.click(screen.getByTitle('Skills'));
    fireEvent.click(screen.getByText('SQL Toolkit'));

    expect(screen.getByTestId('chat-skill-chip')).toHaveTextContent('SQL Toolkit');
  });

  it('filters skills by keyword in the skill picker', () => {
    skillsState.skills = [
      {
        id: 'sql-toolkit',
        name: 'SQL Toolkit',
        description: 'Query helper',
        enabled: true,
      },
      {
        id: 'copywriter',
        name: 'Copywriter',
        description: 'Marketing copy',
        enabled: true,
      },
    ];

    render(<ChatInput onSend={vi.fn()} />);

    fireEvent.click(screen.getByTitle('Skills'));
    fireEvent.change(screen.getByPlaceholderText('搜索 Skill'), { target: { value: 'copy' } });

    expect(screen.getByText('Copywriter')).toBeInTheDocument();
    expect(screen.queryByText('SQL Toolkit')).not.toBeInTheDocument();
  });

  it('injects selected skill context into the sent prompt', () => {
    const onSend = vi.fn();
    skillsState.skills = [
      {
        id: 'sql-toolkit',
        name: 'SQL Toolkit',
        description: 'Query helper',
        enabled: true,
      },
    ];

    render(<ChatInput onSend={onSend} />);

    fireEvent.click(screen.getByTitle('Skills'));
    fireEvent.click(screen.getByText('SQL Toolkit'));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Find failed orders' } });
    fireEvent.click(screen.getByTitle('Send'));

    expect(onSend).toHaveBeenCalledTimes(1);
    const firstArg = onSend.mock.calls[0][0] as string;
    expect(firstArg).toContain('<skill_context name="SQL Toolkit" id="sql-toolkit">');
    expect(firstArg).toContain('Use this skill as the primary approach for this request.');
    expect(firstArg).toContain('<user_request>');
    expect(firstArg).toContain('Find failed orders');
  });

  it('updates agent model when selecting from model dropdown', () => {
    agentsState.agents = [
      {
        id: 'main',
        name: 'Main',
        isDefault: true,
        modelDisplay: 'gpt-5.4',
        modelRef: 'openai/gpt-5.4',
        overrideModelRef: null,
        inheritedModel: true,
        workspace: '~/.boostclaw/openclaw/workspace',
        agentDir: '~/.boostclaw/openclaw/agents/main/agent',
        mainSessionKey: 'agent:main:main',
        channelTypes: [],
      },
    ];
    providersState.accounts = [
      {
        id: 'acc-openai',
        vendorId: 'openai',
        label: 'OpenAI Primary',
        authMode: 'api_key',
        model: 'openai/gpt-5.4',
        enabled: true,
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'acc-anthropic',
        vendorId: 'anthropic',
        label: 'Anthropic Primary',
        authMode: 'api_key',
        model: 'claude-sonnet-4',
        enabled: true,
        updatedAt: '2026-01-02T00:00:00.000Z',
      },
    ];
    providersState.statuses = [
      { id: 'acc-openai', hasKey: true },
      { id: 'acc-anthropic', hasKey: true },
    ];

    render(<ChatInput onSend={vi.fn()} />);

    fireEvent.click(screen.getByTitle('Select model'));
    fireEvent.click(screen.getByText('claude-sonnet-4'));

    expect(agentsState.updateAgentModel).toHaveBeenCalledWith('main', 'anthropic/claude-sonnet-4');
  });
});

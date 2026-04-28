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
    currentSessionKey: 'agent:main:main',
    messages: [] as unknown[],
    switchSession: vi.fn(),
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
    vendors: [] as Array<Record<string, unknown>>,
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
    case 'composer.mainAgentPickerLocked':
      return 'Main chat is fixed — use sidebar to switch';
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
    chatState.currentSessionKey = 'agent:main:main';
    chatState.messages = [];
    gatewayState.status = { state: 'running', port: 18789 };
    agentsState.defaultModelRef = null;
    agentsState.updateAgentModel.mockClear();
    skillsState.skills = [];
    skillsState.fetchSkills.mockClear();
    providersState.accounts = [];
    providersState.statuses = [];
    providersState.vendors = [];
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

    const agentBtn = screen.getByTestId('chat-agent-picker-button');
    expect(agentBtn).toBeDisabled();
    expect(agentBtn).toHaveAttribute('title', 'Main chat is fixed — use sidebar to switch');
    expect(agentBtn).toHaveTextContent('Main');
  });

  it('enables the agent picker when the current session agent is not main', () => {
    chatState.currentAgentId = 'research';
    chatState.currentSessionKey = 'agent:research:main';
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

    render(<ChatInput onSend={vi.fn()} />);

    expect(screen.getByTestId('chat-agent-picker-button')).not.toBeDisabled();
    expect(screen.getByTestId('chat-agent-picker-button')).toHaveAttribute('title', 'Choose agent');
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

  it('updates the selected target agent model from the model dropdown', () => {
    agentsState.agents = [
      {
        id: 'main',
        name: 'Main',
        isDefault: true,
        modelDisplay: 'gpt-5.4',
        modelRef: 'openai/gpt-5.4',
        overrideModelRef: null,
        inheritedModel: true,
        workspace: '~/.openclaw/workspace',
        agentDir: '~/.openclaw/agents/main/agent',
        mainSessionKey: 'agent:main:main',
        channelTypes: [],
      },
      {
        id: 'research',
        name: 'Research',
        isDefault: false,
        modelDisplay: 'gpt-5.4',
        modelRef: 'openai/gpt-5.4',
        overrideModelRef: null,
        inheritedModel: true,
        workspace: '~/.openclaw/workspace-research',
        agentDir: '~/.openclaw/agents/research/agent',
        mainSessionKey: 'agent:research:main',
        channelTypes: [],
      },
    ];
    providersState.accounts = [
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
    providersState.statuses = [{ id: 'acc-anthropic', hasKey: true }];

    chatState.currentAgentId = 'research';
    chatState.currentSessionKey = 'agent:research:main';

    render(<ChatInput onSend={vi.fn()} />);

    fireEvent.click(screen.getByTitle('Select model'));
    fireEvent.click(screen.getByText('claude-sonnet-4'));

    expect(agentsState.updateAgentModel).toHaveBeenCalledWith(
      'research',
      'anthropic/claude-sonnet-4'
    );
  });

  it('offers vendor default models when the provider account has no explicit model id', () => {
    agentsState.agents = [
      {
        id: 'main',
        name: 'Main',
        isDefault: true,
        modelDisplay: 'qwen3.5-plus',
        modelRef: 'custom/qwen3.5-plus',
        overrideModelRef: null,
        inheritedModel: true,
        workspace: '~/.openclaw/workspace',
        agentDir: '~/.openclaw/agents/main/agent',
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
        enabled: true,
        updatedAt: '2026-01-02T00:00:00.000Z',
      },
    ];
    providersState.statuses = [{ id: 'acc-openai', hasKey: true }];
    providersState.vendors = [
      {
        id: 'openai',
        name: 'OpenAI',
        defaultModelId: 'gpt-5.4',
      },
    ];

    render(<ChatInput onSend={vi.fn()} />);

    fireEvent.click(screen.getByTitle('Select model'));
    fireEvent.click(screen.getByText('gpt-5.4'));

    expect(agentsState.updateAgentModel).toHaveBeenCalledWith('main', 'openai/gpt-5.4');
  });

  it('offers fallback and vendor preset models in the model dropdown', () => {
    agentsState.agents = [
      {
        id: 'main',
        name: 'Main',
        isDefault: true,
        modelDisplay: 'qwen3.5-plus',
        modelRef: 'qwen/qwen3.5-plus',
        overrideModelRef: null,
        inheritedModel: true,
        workspace: '~/.openclaw/workspace',
        agentDir: '~/.openclaw/agents/main/agent',
        mainSessionKey: 'agent:main:main',
        channelTypes: [],
      },
    ];
    providersState.accounts = [
      {
        id: 'acc-qwen',
        vendorId: 'qwen',
        label: 'Qwen Primary',
        authMode: 'api_key',
        model: 'qwen3.5-plus',
        fallbackModels: ['qwen3-coder-plus'],
        enabled: true,
        updatedAt: '2026-01-02T00:00:00.000Z',
      },
    ];
    providersState.statuses = [{ id: 'acc-qwen', hasKey: true }];
    providersState.vendors = [
      {
        id: 'qwen',
        name: 'Qwen',
        defaultModelId: 'qwen3.5-plus',
        availableModels: ['qwen3.5-plus', 'qwen3.6-plus', 'qwen3-coder-next', 'qwen3-coder-plus'],
      },
    ];

    render(<ChatInput onSend={vi.fn()} />);

    fireEvent.click(screen.getByTitle('Select model'));

    expect(screen.getAllByText('qwen3.5-plus').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('qwen3-coder-plus')).toBeInTheDocument();
    expect(screen.getByText('qwen3.6-plus')).toBeInTheDocument();
  });
});

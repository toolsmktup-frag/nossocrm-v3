'use client';

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import {
  useVoiceConfigQuery,
  useEnableVoiceMutation,
} from '@/lib/query/hooks/useVoiceCallsQuery';
import { supabase } from '@/lib/supabase';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/queryKeys';
import {
  Phone,
  Key,
  Save,
  Trash2,
  CheckCircle,
  AlertCircle,
  Loader2,
  Mic,
  Volume2,
  Power,
  Bot,
  ExternalLink,
  RefreshCw,
  ChevronDown,
} from 'lucide-react';

// =============================================================================
// Types
// =============================================================================

interface ElevenLabsAgent {
  agent_id: string;
  name: string;
}

// =============================================================================
// VoiceSection
// =============================================================================

export const VoiceSection: React.FC = () => {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const orgId = profile?.organization_id;

  const { data: voiceConfig, isLoading: configLoading } = useVoiceConfigQuery();
  const enableVoice = useEnableVoiceMutation();
  const queryClient = useQueryClient();

  // Local state
  const [apiKey, setApiKey] = useState('');
  const [agentId, setAgentId] = useState('');
  const [savedApiKey, setSavedApiKey] = useState('');
  const [savedAgentId, setSavedAgentId] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const [validationStatus, setValidationStatus] = useState<
    'idle' | 'validating' | 'valid' | 'invalid'
  >('idle');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Agent selector state
  const [agents, setAgents] = useState<ElevenLabsAgent[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(false);
  const [agentMode, setAgentMode] = useState<'text' | 'select'>('text');

  // Load existing config from DB + auto-fetch agents
  useEffect(() => {
    if (!orgId || !supabase) return;

    supabase
      .from('organization_settings')
      .select('elevenlabs_api_key, elevenlabs_agent_id')
      .eq('organization_id', orgId)
      .single()
      .then(({ data }) => {
        if (data?.elevenlabs_api_key) {
          setSavedApiKey(data.elevenlabs_api_key);
          setApiKey(data.elevenlabs_api_key);
        }
        if (data?.elevenlabs_agent_id) {
          setSavedAgentId(data.elevenlabs_agent_id);
          setAgentId(data.elevenlabs_agent_id);
        }
        if (data?.elevenlabs_api_key && data?.elevenlabs_agent_id) {
          setValidationStatus('valid');
          // Auto-fetch agents list on load when config exists
          fetchAgentsWithKey(data.elevenlabs_api_key).then((agentList) => {
            if (agentList.length > 0) {
              setAgents(agentList);
              setAgentMode('select');
            }
          });
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  const hasUnsavedChanges = apiKey !== savedApiKey || agentId !== savedAgentId;
  const isEnabled = voiceConfig?.voice_enabled && voiceConfig?.elevenlabs_agent_id;
  const apiKeyLooksValid = apiKey.startsWith('sk_') && apiKey.length > 10;

  // ─── Fetch agents from ElevenLabs ───

  async function fetchAgentsWithKey(key: string): Promise<ElevenLabsAgent[]> {
    try {
      setLoadingAgents(true);
      const response = await fetch('https://api.elevenlabs.io/v1/convai/agents', {
        headers: { 'xi-api-key': key },
      });
      if (!response.ok) return [];
      const data = await response.json();
      return (data.agents ?? []).map(
        (a: { agent_id: string; name: string }) => ({
          agent_id: a.agent_id,
          name: a.name,
        })
      );
    } catch {
      return [];
    } finally {
      setLoadingAgents(false);
    }
  }

  async function handleFetchAgents() {
    if (!apiKey.trim()) return;
    setValidationError(null);
    const agentList = await fetchAgentsWithKey(apiKey);
    if (agentList.length > 0) {
      setAgents(agentList);
      setAgentMode('select');
    } else {
      setValidationError(
        'Não foi possível buscar os agents. Verifique a API key ou use o ID manualmente.'
      );
    }
  }

  // ─── Validate API key against ElevenLabs ───

  async function validateApiKey(key: string): Promise<boolean> {
    try {
      const response = await fetch('https://api.elevenlabs.io/v1/user', {
        headers: { 'xi-api-key': key },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  // ─── Save config (API key + Agent ID) ───

  async function handleSave() {
    if (!apiKey.trim() || !agentId.trim() || !orgId || !supabase) return;

    setIsSaving(true);
    setValidationStatus('validating');
    setValidationError(null);
    setSuccessMessage(null);

    try {
      // 1. Validate API key
      const isValid = await validateApiKey(apiKey);
      if (!isValid) {
        setValidationStatus('invalid');
        setValidationError('Chave inválida. Verifique sua API key no painel da ElevenLabs.');
        setIsSaving(false);
        return;
      }

      setValidationStatus('valid');

      // 2. Call enable endpoint — saves API key + agent ID, enables voice
      await enableVoice.mutateAsync({ apiKey, agentId });

      setSavedApiKey(apiKey);
      setSavedAgentId(agentId);
      setSuccessMessage('Voice habilitado com sucesso.');

      // 3. Invalidate queries
      queryClient.invalidateQueries({ queryKey: queryKeys.voice.all });
    } catch (error) {
      setValidationStatus('invalid');
      setValidationError(
        error instanceof Error ? error.message : 'Erro ao salvar configuração.'
      );
    } finally {
      setIsSaving(false);
    }
  }

  // ─── Remove config + disable voice ───

  async function handleRemove() {
    if (!orgId || !supabase) return;

    setIsRemoving(true);
    setSuccessMessage(null);

    try {
      await supabase
        .from('organization_settings')
        .update({
          elevenlabs_api_key: null,
          elevenlabs_agent_id: null,
          voice_enabled: false,
        })
        .eq('organization_id', orgId);

      setApiKey('');
      setAgentId('');
      setSavedApiKey('');
      setSavedAgentId('');
      setValidationStatus('idle');
      setValidationError(null);
      setSuccessMessage('Voice desabilitado.');
      setAgents([]);
      setAgentMode('text');

      queryClient.invalidateQueries({ queryKey: queryKeys.voice.all });
    } catch (error) {
      setValidationError(
        error instanceof Error ? error.message : 'Erro ao remover configuração.'
      );
    } finally {
      setIsRemoving(false);
    }
  }

  // ─── Render ───

  if (!isAdmin) {
    return (
      <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-6">
        <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-1 flex items-center gap-2">
          <Phone className="h-5 w-5" /> Voice AI
        </h3>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Apenas administradores podem configurar Voice AI.
        </p>
      </div>
    );
  }

  // Resolve agent name for display
  const selectedAgent = agents.find((a) => a.agent_id === agentId);

  return (
    <div className="bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-2xl p-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white flex items-center gap-2">
            <Phone className="h-5 w-5" /> Voice AI (ElevenLabs)
          </h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Chamadas de voz com IA para qualificação de leads diretamente do cockpit do deal.
          </p>
        </div>

        {/* Status badge */}
        {configLoading ? (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-500">
            <Loader2 className="h-3 w-3 animate-spin" /> Carregando
          </span>
        ) : isEnabled ? (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-500/30">
            <Power className="h-3 w-3" /> Ativo
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
            <Power className="h-3 w-3" /> Inativo
          </span>
        )}
      </div>

      {/* How it works */}
      <div className="rounded-xl bg-slate-50 dark:bg-white/3 border border-slate-100 dark:border-white/5 p-4 mb-6">
        <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">
          Como funciona:
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="flex items-start gap-2">
            <Mic className="h-4 w-4 text-purple-500 mt-0.5 shrink-0" />
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Vendedor inicia chamada de voz no cockpit do deal
            </p>
          </div>
          <div className="flex items-start gap-2">
            <Volume2 className="h-4 w-4 text-purple-500 mt-0.5 shrink-0" />
            <p className="text-xs text-slate-600 dark:text-slate-400">
              IA conversa com o lead usando contexto do deal (BANT)
            </p>
          </div>
          <div className="flex items-start gap-2">
            <CheckCircle className="h-4 w-4 text-purple-500 mt-0.5 shrink-0" />
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Transcript salvo, BANT extraído, estágio avaliado automaticamente
            </p>
          </div>
        </div>
      </div>

      {/* Setup instructions */}
      <div className="rounded-xl bg-purple-50 dark:bg-purple-900/10 border border-purple-100 dark:border-purple-500/20 p-4 mb-6">
        <div className="flex items-start gap-2">
          <Bot className="h-4 w-4 text-purple-600 dark:text-purple-400 mt-0.5 shrink-0" />
          <div className="space-y-1">
            <p className="text-sm font-medium text-purple-800 dark:text-purple-300">
              Configure seu agent no ElevenLabs
            </p>
            <p className="text-xs text-purple-700 dark:text-purple-400">
              Crie e personalize seu Conversational AI Agent no painel da ElevenLabs, depois cole
              a API Key abaixo e selecione o agent desejado.
            </p>
            <a
              href="https://elevenlabs.io/app/conversational-ai"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-purple-600 dark:text-purple-400 hover:underline mt-1"
            >
              Abrir ElevenLabs Conversational AI <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>
      </div>

      {/* Form fields */}
      <div className="space-y-4">
        {/* API Key */}
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2 flex items-center gap-1.5">
            <Key className="h-4 w-4" /> API Key da ElevenLabs
          </label>
          <div className="relative">
            <input
              type="password"
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value);
                setValidationStatus('idle');
                setValidationError(null);
                setSuccessMessage(null);
                // Reset agent selector if key changes
                if (e.target.value !== savedApiKey) {
                  setAgents([]);
                  setAgentMode('text');
                }
              }}
              placeholder="sk_..."
              className={`w-full bg-slate-50 dark:bg-slate-800 border rounded-lg px-3 py-2.5 pr-10 text-sm text-slate-900 dark:text-white focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 outline-none transition-all ${
                validationStatus === 'invalid'
                  ? 'border-red-300 dark:border-red-500/50'
                  : validationStatus === 'valid'
                    ? 'border-green-300 dark:border-green-500/50'
                    : 'border-slate-200 dark:border-white/10'
              }`}
            />
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              {validationStatus === 'validating' ? (
                <Loader2 size={16} className="text-purple-500 animate-spin" />
              ) : validationStatus === 'valid' ? (
                <CheckCircle size={16} className="text-green-500" />
              ) : validationStatus === 'invalid' ? (
                <AlertCircle size={16} className="text-red-500" />
              ) : apiKey ? (
                <AlertCircle size={16} className="text-amber-500" />
              ) : null}
            </div>
          </div>
        </div>

        {/* Agent selector */}
        <div>
          {/* Label row — with Buscar / Digitar manualmente toggle */}
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
              <Bot className="h-4 w-4" /> Agent
            </label>
            {agentMode === 'text' && apiKeyLooksValid && (
              <button
                type="button"
                onClick={handleFetchAgents}
                disabled={loadingAgents}
                className="inline-flex items-center gap-1.5 text-xs text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 transition-colors disabled:opacity-50"
              >
                {loadingAgents ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <RefreshCw size={12} />
                )}
                Buscar meus agents
              </button>
            )}
            {agentMode === 'select' && (
              <button
                type="button"
                onClick={() => setAgentMode('text')}
                className="text-xs text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
              >
                Digitar manualmente
              </button>
            )}
          </div>

          {/* Select mode */}
          {agentMode === 'select' && agents.length > 0 ? (
            <div className="space-y-1.5">
              <div className="relative">
                <select
                  value={agentId}
                  onChange={(e) => {
                    setAgentId(e.target.value);
                    setValidationStatus('idle');
                    setValidationError(null);
                    setSuccessMessage(null);
                  }}
                  className="w-full appearance-none bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2.5 pr-9 text-sm text-slate-900 dark:text-white focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 outline-none transition-all"
                >
                  <option value="">Selecione um agent...</option>
                  {agents.map((agent) => (
                    <option key={agent.agent_id} value={agent.agent_id}>
                      {agent.name}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={16}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
                />
              </div>
              {/* Show agent_id below select */}
              {agentId && (
                <p className="text-xs text-slate-400 dark:text-slate-500 font-mono truncate">
                  {agentId}
                </p>
              )}
            </div>
          ) : (
            /* Text input mode */
            <div>
              <input
                type="text"
                value={agentId}
                onChange={(e) => {
                  setAgentId(e.target.value);
                  setValidationStatus('idle');
                  setValidationError(null);
                  setSuccessMessage(null);
                }}
                placeholder="agent_..."
                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2.5 text-sm text-slate-900 dark:text-white focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 outline-none transition-all font-mono"
              />
              <p className="mt-1.5 text-xs text-slate-400 dark:text-slate-500">
                Encontre o Agent ID em{' '}
                <a
                  href="https://elevenlabs.io/app/conversational-ai"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-purple-500 hover:underline"
                >
                  ElevenLabs → Conversational AI → seu agent
                </a>
              </p>
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex gap-2">
          <button
            onClick={handleSave}
            disabled={
              isSaving ||
              !apiKey.trim() ||
              !agentId.trim() ||
              (!hasUnsavedChanges && validationStatus === 'valid')
            }
            className={`px-4 py-2.5 rounded-lg text-sm font-medium flex items-center gap-2 transition-all whitespace-nowrap ${
              isSaving ||
              !apiKey.trim() ||
              !agentId.trim() ||
              (!hasUnsavedChanges && validationStatus === 'valid')
                ? 'bg-slate-100 dark:bg-slate-800 text-slate-400 cursor-not-allowed'
                : 'bg-purple-600 hover:bg-purple-700 text-white shadow-lg shadow-purple-600/20'
            }`}
          >
            {isSaving ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                {isEnabled ? 'Salvando...' : 'Ativando...'}
              </>
            ) : (
              <>
                <Save size={16} />
                {!savedApiKey || !savedAgentId
                  ? 'Ativar Voice'
                  : hasUnsavedChanges
                    ? 'Salvar'
                    : 'Salvo'}
              </>
            )}
          </button>

          {/* Remove button */}
          {(savedApiKey || savedAgentId) && (
            <button
              onClick={handleRemove}
              disabled={isRemoving}
              className="px-3 py-2.5 rounded-lg text-sm font-medium flex items-center gap-1 transition-all text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20 border border-red-200 dark:border-red-500/30"
            >
              {isRemoving ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Trash2 size={16} />
              )}
            </button>
          )}
        </div>

        {/* Validation error */}
        {validationError && (
          <div className="rounded-lg p-3 flex items-start gap-2 bg-red-50 dark:bg-red-900/10 text-red-800 dark:text-red-200 border border-red-100 dark:border-red-500/20">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <p className="text-sm">{validationError}</p>
          </div>
        )}

        {/* Success message */}
        {successMessage && (
          <div className="rounded-lg p-3 flex items-start gap-2 bg-green-50 dark:bg-green-900/10 text-green-800 dark:text-green-200 border border-green-100 dark:border-green-500/20">
            <CheckCircle size={16} className="mt-0.5 shrink-0" />
            <p className="text-sm">{successMessage}</p>
          </div>
        )}

        {/* Active agent info */}
        {isEnabled && voiceConfig?.elevenlabs_agent_id && (
          <div className="rounded-lg p-3 bg-purple-50 dark:bg-purple-900/10 border border-purple-100 dark:border-purple-500/20">
            <p className="text-xs text-purple-700 dark:text-purple-300">
              <span className="font-medium">Agent ativo:</span>{' '}
              {selectedAgent ? (
                <>
                  <span className="font-medium">{selectedAgent.name}</span>{' '}
                  <code className="bg-purple-100 dark:bg-purple-800/30 px-1.5 py-0.5 rounded text-xs font-mono ml-1">
                    {voiceConfig.elevenlabs_agent_id}
                  </code>
                </>
              ) : (
                <code className="bg-purple-100 dark:bg-purple-800/30 px-1.5 py-0.5 rounded text-xs font-mono">
                  {voiceConfig.elevenlabs_agent_id}
                </code>
              )}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

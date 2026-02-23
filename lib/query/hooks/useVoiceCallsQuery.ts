/**
 * @fileoverview Voice Calls Query Hooks
 *
 * TanStack Query hooks para voice calls.
 *
 * @module lib/query/hooks/useVoiceCallsQuery
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../queryKeys';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';
import type {
  VoiceCallListItem,
  StartVoiceCallResponse,
  DynamicVariables,
} from '@/lib/voice/elevenlabs.types';

// =============================================================================
// Types
// =============================================================================

export interface VoiceConfig {
  voice_enabled: boolean;
  elevenlabs_agent_id: string | null;
}

// =============================================================================
// Voice Config Query
// =============================================================================

export function useVoiceConfigQuery() {
  const { profile } = useAuth();
  const orgId = profile?.organization_id;

  return useQuery({
    queryKey: queryKeys.voice.config(),
    queryFn: async (): Promise<VoiceConfig> => {
      if (!supabase || !orgId) throw new Error('Not authenticated');

      const { data, error } = await supabase
        .from('organization_settings')
        .select('voice_enabled, elevenlabs_agent_id')
        .eq('organization_id', orgId)
        .single();

      if (error) throw error;

      return {
        voice_enabled: data?.voice_enabled ?? false,
        elevenlabs_agent_id: data?.elevenlabs_agent_id ?? null,
      };
    },
    enabled: !!orgId,
    staleTime: 0, // Always refetch — ensures badge updates immediately after enable/disable
  });
}

// =============================================================================
// Voice Calls List Query
// =============================================================================

export function useVoiceCallsQuery(dealId: string | undefined) {
  const { profile } = useAuth();
  const orgId = profile?.organization_id;

  return useQuery({
    queryKey: queryKeys.voice.calls(dealId ?? ''),
    queryFn: async (): Promise<VoiceCallListItem[]> => {
      const response = await fetch(`/api/voice/calls?dealId=${dealId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch voice calls');
      }
      const data = await response.json();
      return data.calls;
    },
    enabled: !!dealId && !!orgId,
    staleTime: 30 * 1000,
  });
}

// =============================================================================
// Start Voice Call Mutation
// =============================================================================

interface StartVoiceCallParams {
  dealId: string;
  mode?: 'ai_agent' | 'human_call';
  channel?: 'web' | 'whatsapp' | 'phone';
}

export function useStartVoiceCallMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      params: StartVoiceCallParams
    ): Promise<StartVoiceCallResponse> => {
      // 1. Get signed URL with dynamic variables
      const signedUrlResponse = await fetch(
        `/api/voice/signed-url?dealId=${params.dealId}`
      );
      if (!signedUrlResponse.ok) {
        const err = await signedUrlResponse.json();
        throw new Error(err.error || 'Failed to get signed URL');
      }
      const { signedUrl, dynamicVariables, elevenlabsConversationId } =
        await signedUrlResponse.json();

      // 2. Create voice call record
      const callResponse = await fetch('/api/voice/calls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dealId: params.dealId,
          mode: params.mode || 'ai_agent',
          channel: params.channel || 'web',
          elevenlabsConversationId,
        }),
      });
      if (!callResponse.ok) {
        const err = await callResponse.json();
        throw new Error(err.error || 'Failed to create call');
      }
      const { callId } = await callResponse.json();

      return {
        callId,
        signedUrl,
        dynamicVariables: dynamicVariables as DynamicVariables,
        elevenlabsConversationId,
      };
    },
    onSuccess: (_data, params) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.voice.calls(params.dealId),
      });
    },
  });
}

// =============================================================================
// Enable Voice Mutation
// =============================================================================

export function useEnableVoiceMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: { apiKey: string; agentId: string }): Promise<{ agentId: string }> => {
      const response = await fetch('/api/voice/enable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: params.apiKey, agentId: params.agentId }),
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to enable voice');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.voice.all });
    },
  });
}

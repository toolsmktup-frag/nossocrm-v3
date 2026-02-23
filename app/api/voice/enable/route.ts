/**
 * @fileoverview Voice Enable API
 *
 * POST /api/voice/enable
 * Salva API key + Agent ID da ElevenLabs e habilita voice para a organização.
 * O agent deve ser criado previamente no painel da ElevenLabs.
 * Apenas admins podem habilitar.
 *
 * @module app/api/voice/enable/route
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();

    // Verify authentication
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check admin role
    const { data: profile } = await supabase
      .from('profiles')
      .select('organization_id, role')
      .eq('id', user.id)
      .single();

    if (!profile?.organization_id) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }

    if (profile.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Parse body — API key + Agent ID (imported from ElevenLabs dashboard)
    const body = await request.json().catch(() => ({}));
    const { apiKey, agentId } = body as { apiKey?: string; agentId?: string };

    if (!apiKey) {
      return NextResponse.json(
        { error: 'apiKey is required' },
        { status: 400 }
      );
    }

    if (!agentId) {
      return NextResponse.json(
        { error: 'agentId is required' },
        { status: 400 }
      );
    }

    // Save API key, agent ID, and enable voice
    const { error: updateError } = await supabase
      .from('organization_settings')
      .update({
        voice_enabled: true,
        elevenlabs_agent_id: agentId,
        elevenlabs_api_key: apiKey,
      })
      .eq('organization_id', profile.organization_id);

    if (updateError) {
      console.error('[Voice Enable] Failed to update settings:', updateError);
      return NextResponse.json(
        { error: 'Failed to save settings' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      message: 'Voice enabled successfully',
      agentId,
    });
  } catch (error) {
    console.error('[Voice Enable] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to enable voice' },
      { status: 500 }
    );
  }
}

import { supabase } from './supabase'

export type BannerAction = 'paywall' | 'link' | 'none'

export type BannerConfig = {
  id: number
  enabled: boolean
  title: string | null
  subtitle: string | null
  gradient_start: string | null
  gradient_end: string | null
  background_color: string | null
  text_color: string | null
  image_key: string | null
  image_large_key: string | null
  action: BannerAction
  action_link: string | null
  updated_at: string
}

export type BannerConfigInput = Omit<BannerConfig, 'id' | 'updated_at'>

export async function fetchBannerConfig(id: number): Promise<BannerConfig | null> {
  const { data, error } = await supabase
    .from('banner_config')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return (data as BannerConfig) ?? null
}

export async function saveBannerConfig(
  id: number,
  input: BannerConfigInput,
): Promise<BannerConfig> {
  const { data, error } = await supabase
    .from('banner_config')
    .upsert({ id, ...input, updated_at: new Date().toISOString() })
    .select()
    .single()
  if (error) throw error
  return data as BannerConfig
}

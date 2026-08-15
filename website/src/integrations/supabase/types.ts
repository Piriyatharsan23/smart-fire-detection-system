export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      alert_settings: {
        Row: {
          cooldown_seconds: number
          enabled: boolean
          id: number
          last_alert_at: string | null
          last_alert_status: string | null
          telegram_chat_id: string | null
          updated_at: string
          whatsapp_from: string | null
          whatsapp_to: string | null
        }
        Insert: {
          cooldown_seconds?: number
          enabled?: boolean
          id?: number
          last_alert_at?: string | null
          last_alert_status?: string | null
          telegram_chat_id?: string | null
          updated_at?: string
          whatsapp_from?: string | null
          whatsapp_to?: string | null
        }
        Update: {
          cooldown_seconds?: number
          enabled?: boolean
          id?: number
          last_alert_at?: string | null
          last_alert_status?: string | null
          telegram_chat_id?: string | null
          updated_at?: string
          whatsapp_from?: string | null
          whatsapp_to?: string | null
        }
        Relationships: []
      }
      alerts: {
        Row: {
          alert_message: string
          alert_type: string
          id: number
          sensor_value: number | null
          severity: string
          status: string
          ts: string
        }
        Insert: {
          alert_message: string
          alert_type: string
          id?: number
          sensor_value?: number | null
          severity?: string
          status?: string
          ts?: string
        }
        Update: {
          alert_message?: string
          alert_type?: string
          id?: number
          sensor_value?: number | null
          severity?: string
          status?: string
          ts?: string
        }
        Relationships: []
      }
      connection_log: {
        Row: {
          id: number
          level: string
          message: string
          ts: string
        }
        Insert: {
          id?: number
          level?: string
          message: string
          ts?: string
        }
        Update: {
          id?: number
          level?: string
          message?: string
          ts?: string
        }
        Relationships: []
      }
      device_state: {
        Row: {
          buzzer: boolean
          fan: boolean
          id: number
          suppression: boolean
          updated_at: string
        }
        Insert: {
          buzzer?: boolean
          fan?: boolean
          id?: number
          suppression?: boolean
          updated_at?: string
        }
        Update: {
          buzzer?: boolean
          fan?: boolean
          id?: number
          suppression?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      reset_state: {
        Row: {
          id: number
          last_reset_at: string | null
          state: string
          updated_at: string
        }
        Insert: {
          id?: number
          last_reset_at?: string | null
          state?: string
          updated_at?: string
        }
        Update: {
          id?: number
          last_reset_at?: string | null
          state?: string
          updated_at?: string
        }
        Relationships: []
      }
      sensor_readings: {
        Row: {
          current_amps: number | null
          fan_speed: number | null
          fan_voltage: number | null
          flame: number
          flame_voltage: number | null
          id: number
          indoor_temp_voltage: number | null
          outdoor_temp_voltage: number | null
          smoke: number
          smoke_baseline: number | null
          smoke_percentage: number | null
          smoke_voltage: number | null
          status: string
          system_state: number | null
          temp: number
          temp_out: number | null
          ts: string
        }
        Insert: {
          current_amps?: number | null
          fan_speed?: number | null
          fan_voltage?: number | null
          flame: number
          flame_voltage?: number | null
          id?: number
          indoor_temp_voltage?: number | null
          outdoor_temp_voltage?: number | null
          smoke: number
          smoke_baseline?: number | null
          smoke_percentage?: number | null
          smoke_voltage?: number | null
          status: string
          system_state?: number | null
          temp: number
          temp_out?: number | null
          ts?: string
        }
        Update: {
          current_amps?: number | null
          fan_speed?: number | null
          fan_voltage?: number | null
          flame?: number
          flame_voltage?: number | null
          id?: number
          indoor_temp_voltage?: number | null
          outdoor_temp_voltage?: number | null
          smoke?: number
          smoke_baseline?: number | null
          smoke_percentage?: number | null
          smoke_voltage?: number | null
          status?: string
          system_state?: number | null
          temp?: number
          temp_out?: number | null
          ts?: string
        }
        Relationships: []
      }
      telegram_subscribers: {
        Row: {
          chat_id: string
          created_at: string
          id: number
          notifications_enabled: boolean
          username: string | null
        }
        Insert: {
          chat_id: string
          created_at?: string
          id?: number
          notifications_enabled?: boolean
          username?: string | null
        }
        Update: {
          chat_id?: string
          created_at?: string
          id?: number
          notifications_enabled?: boolean
          username?: string | null
        }
        Relationships: []
      }
      thresholds: {
        Row: {
          current_critical_pct: number
          current_warning_pct: number
          fan_auto_mode: boolean
          id: number
          rated_current: number
          smoke: number
          smoke_baseline_voltage: number
          smoke_detection_threshold: number
          smoke_max_drop: number
          smoke_tolerance: number
          temp: number
          temp_delta_warning: number
          temperature_scale_factor: number
          updated_at: string
        }
        Insert: {
          current_critical_pct?: number
          current_warning_pct?: number
          fan_auto_mode?: boolean
          id?: number
          rated_current?: number
          smoke?: number
          smoke_baseline_voltage?: number
          smoke_detection_threshold?: number
          smoke_max_drop?: number
          smoke_tolerance?: number
          temp?: number
          temp_delta_warning?: number
          temperature_scale_factor?: number
          updated_at?: string
        }
        Update: {
          current_critical_pct?: number
          current_warning_pct?: number
          fan_auto_mode?: boolean
          id?: number
          rated_current?: number
          smoke?: number
          smoke_baseline_voltage?: number
          smoke_detection_threshold?: number
          smoke_max_drop?: number
          smoke_tolerance?: number
          temp?: number
          temp_delta_warning?: number
          temperature_scale_factor?: number
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

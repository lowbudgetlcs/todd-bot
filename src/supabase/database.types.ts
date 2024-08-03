export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      accounts: {
        Row: {
          id: number
          is_primary: boolean
          player_id: number
          riot_puuid: string
        }
        Insert: {
          id?: number
          is_primary: boolean
          player_id: number
          riot_puuid: string
        }
        Update: {
          id?: number
          is_primary?: boolean
          player_id?: number
          riot_puuid?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_player"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      divisions: {
        Row: {
          description: string | null
          groups: number | null
          id: number
          name: string | null
          provider_id: number
          tournament_id: number
        }
        Insert: {
          description?: string | null
          groups?: number | null
          id?: number
          name?: string | null
          provider_id: number
          tournament_id: number
        }
        Update: {
          description?: string | null
          groups?: number | null
          id?: number
          name?: string | null
          provider_id?: number
          tournament_id?: number
        }
        Relationships: []
      }
      games: {
        Row: {
          id: number
          loser_id: number | null
          result_id: number | null
          series_id: number
          short_code: string
          winner_id: number | null
        }
        Insert: {
          id?: number
          loser_id?: number | null
          result_id?: number | null
          series_id: number
          short_code: string
          winner_id?: number | null
        }
        Update: {
          id?: number
          loser_id?: number | null
          result_id?: number | null
          series_id?: number
          short_code?: string
          winner_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_loser"
            columns: ["loser_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_result"
            columns: ["result_id"]
            isOneToOne: false
            referencedRelation: "results"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_series"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "series"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_winner"
            columns: ["winner_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      group_keys: {
        Row: {
          id: number
          letter: string | null
        }
        Insert: {
          id: number
          letter?: string | null
        }
        Update: {
          id?: number
          letter?: string | null
        }
        Relationships: []
      }
      performances: {
        Row: {
          game_id: number | null
          id: number
          player_id: number | null
          team_id: number | null
        }
        Insert: {
          game_id?: number | null
          id?: number
          player_id?: number | null
          team_id?: number | null
        }
        Update: {
          game_id?: number | null
          id?: number
          player_id?: number | null
          team_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_game"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_player"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_team"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      players: {
        Row: {
          id: number
          primary_riot_puuid: string
          team_id: number | null
        }
        Insert: {
          id?: number
          primary_riot_puuid: string
          team_id?: number | null
        }
        Update: {
          id?: number
          primary_riot_puuid?: string
          team_id?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_team"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      results: {
        Row: {
          game_id: number | null
          game_map: string | null
          game_mode: string | null
          game_name: string | null
          game_type: string | null
          id: number
          meta_data: string
          region: string | null
          short_code: string
          start_time: number | null
        }
        Insert: {
          game_id?: number | null
          game_map?: string | null
          game_mode?: string | null
          game_name?: string | null
          game_type?: string | null
          id?: number
          meta_data: string
          region?: string | null
          short_code: string
          start_time?: number | null
        }
        Update: {
          game_id?: number | null
          game_map?: string | null
          game_mode?: string | null
          game_name?: string | null
          game_type?: string | null
          id?: number
          meta_data?: string
          region?: string | null
          short_code?: string
          start_time?: number | null
        }
        Relationships: []
      }
      schedules: {
        Row: {
          division_id: number
          group_id: string
          id: number
          series_id: number
          week: number
        }
        Insert: {
          division_id: number
          group_id: string
          id?: number
          series_id: number
          week: number
        }
        Update: {
          division_id?: number
          group_id?: string
          id?: number
          series_id?: number
          week?: number
        }
        Relationships: [
          {
            foreignKeyName: "fk_division"
            columns: ["division_id"]
            isOneToOne: false
            referencedRelation: "divisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_series"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "series"
            referencedColumns: ["id"]
          },
        ]
      }
      series: {
        Row: {
          id: number
          message_id: number | null
          playoffs: boolean
          team1_id: number
          team2_id: number
          win_condition: number
        }
        Insert: {
          id?: number
          message_id?: number | null
          playoffs: boolean
          team1_id: number
          team2_id: number
          win_condition: number
        }
        Update: {
          id?: number
          message_id?: number | null
          playoffs?: boolean
          team1_id?: number
          team2_id?: number
          win_condition?: number
        }
        Relationships: [
          {
            foreignKeyName: "fk_team1"
            columns: ["team1_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_team2"
            columns: ["team2_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      standings: {
        Row: {
          division_id: number
          group_id: string
          id: number
          placement: number
          team_id: number
        }
        Insert: {
          division_id: number
          group_id: string
          id?: number
          placement: number
          team_id: number
        }
        Update: {
          division_id?: number
          group_id?: string
          id?: number
          placement?: number
          team_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "fk_team"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          captain_id: number | null
          division_id: number
          group_id: string
          id: number
          logo: string | null
          name: string
        }
        Insert: {
          captain_id?: number | null
          division_id: number
          group_id: string
          id?: number
          logo?: string | null
          name: string
        }
        Update: {
          captain_id?: number | null
          division_id?: number
          group_id?: string
          id?: number
          logo?: string | null
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_captain"
            columns: ["captain_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_division"
            columns: ["division_id"]
            isOneToOne: false
            referencedRelation: "divisions"
            referencedColumns: ["id"]
          },
        ]
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

type PublicSchema = Database[Extract<keyof Database, "public">]

export type Tables<
  PublicTableNameOrOptions extends
    | keyof (PublicSchema["Tables"] & PublicSchema["Views"])
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
        Database[PublicTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? (Database[PublicTableNameOrOptions["schema"]]["Tables"] &
      Database[PublicTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : PublicTableNameOrOptions extends keyof (PublicSchema["Tables"] &
        PublicSchema["Views"])
    ? (PublicSchema["Tables"] &
        PublicSchema["Views"])[PublicTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  PublicTableNameOrOptions extends
    | keyof PublicSchema["Tables"]
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : PublicTableNameOrOptions extends keyof PublicSchema["Tables"]
    ? PublicSchema["Tables"][PublicTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  PublicTableNameOrOptions extends
    | keyof PublicSchema["Tables"]
    | { schema: keyof Database },
  TableName extends PublicTableNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = PublicTableNameOrOptions extends { schema: keyof Database }
  ? Database[PublicTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : PublicTableNameOrOptions extends keyof PublicSchema["Tables"]
    ? PublicSchema["Tables"][PublicTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  PublicEnumNameOrOptions extends
    | keyof PublicSchema["Enums"]
    | { schema: keyof Database },
  EnumName extends PublicEnumNameOrOptions extends { schema: keyof Database }
    ? keyof Database[PublicEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = PublicEnumNameOrOptions extends { schema: keyof Database }
  ? Database[PublicEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : PublicEnumNameOrOptions extends keyof PublicSchema["Enums"]
    ? PublicSchema["Enums"][PublicEnumNameOrOptions]
    : never

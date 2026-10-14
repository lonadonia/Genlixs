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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      affiliate_accounts: {
        Row: {
          agreement_version_id: string | null
          application: Json
          created_at: string
          id: string
          payout_currency: string
          qualifying_customers: number
          rejection_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          state: string
          tier: string
          updated_at: string
          user_id: string
        }
        Insert: {
          agreement_version_id?: string | null
          application: Json
          created_at?: string
          id?: string
          payout_currency?: string
          qualifying_customers?: number
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          state?: string
          tier?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          agreement_version_id?: string | null
          application?: Json
          created_at?: string
          id?: string
          payout_currency?: string
          qualifying_customers?: number
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          state?: string
          tier?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_accounts_agreement_version_id_fkey"
            columns: ["agreement_version_id"]
            isOneToOne: false
            referencedRelation: "affiliate_agreement_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_accounts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      affiliate_agreement_versions: {
        Row: {
          attribution_window_days: number
          base_rate_bps: number
          confirmed: Json
          created_at: string
          hold_days: number
          id: string
          payout_thresholds: Json
          published_at: string | null
          published_by: string | null
          renewal_months: number
          state: string
          terms_summary: string
          uplift_rate_bps: number
          uplift_rule: string
          uplift_threshold: number
          version: number
        }
        Insert: {
          attribution_window_days: number
          base_rate_bps: number
          confirmed: Json
          created_at?: string
          hold_days: number
          id?: string
          payout_thresholds: Json
          published_at?: string | null
          published_by?: string | null
          renewal_months: number
          state?: string
          terms_summary: string
          uplift_rate_bps: number
          uplift_rule?: string
          uplift_threshold: number
          version: number
        }
        Update: {
          attribution_window_days?: number
          base_rate_bps?: number
          confirmed?: Json
          created_at?: string
          hold_days?: number
          id?: string
          payout_thresholds?: Json
          published_at?: string | null
          published_by?: string | null
          renewal_months?: number
          state?: string
          terms_summary?: string
          uplift_rate_bps?: number
          uplift_rule?: string
          uplift_threshold?: number
          version?: number
        }
        Relationships: []
      }
      affiliate_links: {
        Row: {
          affiliate_id: string
          archived_at: string | null
          campaign: string | null
          channel: string | null
          created_at: string
          destination: string
          id: string
          is_main: boolean
          slug: string
          sub_id: string | null
        }
        Insert: {
          affiliate_id: string
          archived_at?: string | null
          campaign?: string | null
          channel?: string | null
          created_at?: string
          destination: string
          id?: string
          is_main?: boolean
          slug: string
          sub_id?: string | null
        }
        Update: {
          affiliate_id?: string
          archived_at?: string | null
          campaign?: string | null
          channel?: string | null
          created_at?: string
          destination?: string
          id?: string
          is_main?: boolean
          slug?: string
          sub_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_links_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "affiliate_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      assets: {
        Row: {
          bucket: string
          bytes: number | null
          created_at: string
          deleted_at: string | null
          duration_ms: number | null
          height: number | null
          id: string
          job_id: string | null
          kind: string
          mime: string | null
          object_path: string
          original_name: string | null
          provider_task_id: string | null
          purpose: string
          retention_until: string | null
          sha256: string | null
          state: string
          updated_at: string
          user_id: string
          width: number | null
        }
        Insert: {
          bucket: string
          bytes?: number | null
          created_at?: string
          deleted_at?: string | null
          duration_ms?: number | null
          height?: number | null
          id?: string
          job_id?: string | null
          kind: string
          mime?: string | null
          object_path: string
          original_name?: string | null
          provider_task_id?: string | null
          purpose?: string
          retention_until?: string | null
          sha256?: string | null
          state?: string
          updated_at?: string
          user_id: string
          width?: number | null
        }
        Update: {
          bucket?: string
          bytes?: number | null
          created_at?: string
          deleted_at?: string | null
          duration_ms?: number | null
          height?: number | null
          id?: string
          job_id?: string | null
          kind?: string
          mime?: string | null
          object_path?: string
          original_name?: string | null
          provider_task_id?: string | null
          purpose?: string
          retention_until?: string | null
          sha256?: string | null
          state?: string
          updated_at?: string
          user_id?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "assets_job_fk"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "generation_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      billing_transactions: {
        Row: {
          amount_minor: number
          created_at: string
          currency: string
          gateway: string
          gateway_object_id: string
          id: string
          kind: string
          order_id: string | null
          receipt_id: string | null
          state: string
          subscription_id: string | null
          user_id: string
        }
        Insert: {
          amount_minor: number
          created_at?: string
          currency: string
          gateway: string
          gateway_object_id: string
          id?: string
          kind: string
          order_id?: string | null
          receipt_id?: string | null
          state: string
          subscription_id?: string | null
          user_id: string
        }
        Update: {
          amount_minor?: number
          created_at?: string
          currency?: string
          gateway?: string
          gateway_object_id?: string
          id?: string
          kind?: string
          order_id?: string | null
          receipt_id?: string | null
          state?: string
          subscription_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_transactions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "payment_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_transactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      collection_assets: {
        Row: {
          added_at: string
          asset_id: string
          collection_id: string
          user_id: string
        }
        Insert: {
          added_at?: string
          asset_id: string
          collection_id: string
          user_id: string
        }
        Update: {
          added_at?: string
          asset_id?: string
          collection_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "collection_assets_asset_id_user_id_fkey"
            columns: ["asset_id", "user_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "collection_assets_collection_id_user_id_fkey"
            columns: ["collection_id", "user_id"]
            isOneToOne: false
            referencedRelation: "collections"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      collections: {
        Row: {
          created_at: string
          id: string
          name: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "collections_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      commission_adjustments: {
        Row: {
          affiliate_id: string
          amount_minor: number
          commission_id: string
          created_at: string
          currency: string
          id: string
          reason: string
          settled_batch_id: string | null
          source_key: string
        }
        Insert: {
          affiliate_id: string
          amount_minor: number
          commission_id: string
          created_at?: string
          currency: string
          id?: string
          reason: string
          settled_batch_id?: string | null
          source_key: string
        }
        Update: {
          affiliate_id?: string
          amount_minor?: number
          commission_id?: string
          created_at?: string
          currency?: string
          id?: string
          reason?: string
          settled_batch_id?: string | null
          source_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "commission_adjustments_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "affiliate_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_adjustments_commission_id_fkey"
            columns: ["commission_id"]
            isOneToOne: false
            referencedRelation: "commission_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      commission_entries: {
        Row: {
          affiliate_id: string
          agreement_version_id: string
          amount_minor: number
          base_minor: number
          billing_tx_id: string | null
          created_at: string
          currency: string
          customer_id: string
          customer_ref: string
          eligible_at: string | null
          hold_until: string
          id: string
          order_id: string | null
          payout_batch_id: string | null
          rate_bps: number
          refunded_base_minor: number
          reversed_minor: number
          source_key: string
          state: string
          updated_at: string
        }
        Insert: {
          affiliate_id: string
          agreement_version_id: string
          amount_minor: number
          base_minor: number
          billing_tx_id?: string | null
          created_at?: string
          currency: string
          customer_id: string
          customer_ref: string
          eligible_at?: string | null
          hold_until: string
          id?: string
          order_id?: string | null
          payout_batch_id?: string | null
          rate_bps: number
          refunded_base_minor?: number
          reversed_minor?: number
          source_key: string
          state?: string
          updated_at?: string
        }
        Update: {
          affiliate_id?: string
          agreement_version_id?: string
          amount_minor?: number
          base_minor?: number
          billing_tx_id?: string | null
          created_at?: string
          currency?: string
          customer_id?: string
          customer_ref?: string
          eligible_at?: string | null
          hold_until?: string
          id?: string
          order_id?: string | null
          payout_batch_id?: string | null
          rate_bps?: number
          refunded_base_minor?: number
          reversed_minor?: number
          source_key?: string
          state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "commission_entries_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "affiliate_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_entries_agreement_version_id_fkey"
            columns: ["agreement_version_id"]
            isOneToOne: false
            referencedRelation: "affiliate_agreement_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_entries_billing_tx_id_fkey"
            columns: ["billing_tx_id"]
            isOneToOne: false
            referencedRelation: "billing_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commission_entries_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "payment_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_ledger: {
        Row: {
          actor_id: string | null
          created_at: string
          d_available: number
          d_expired: number
          d_reserved: number
          d_revoked: number
          d_spent: number
          event_key: string
          event_type: string
          id: string
          idempotency_key: string
          job_id: string | null
          lot_id: string | null
          note: string | null
          reservation_id: string | null
          source_ref: string | null
          user_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          d_available?: number
          d_expired?: number
          d_reserved?: number
          d_revoked?: number
          d_spent?: number
          event_key: string
          event_type: string
          id?: string
          idempotency_key: string
          job_id?: string | null
          lot_id?: string | null
          note?: string | null
          reservation_id?: string | null
          source_ref?: string | null
          user_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          d_available?: number
          d_expired?: number
          d_reserved?: number
          d_revoked?: number
          d_spent?: number
          event_key?: string
          event_type?: string
          id?: string
          idempotency_key?: string
          job_id?: string | null
          lot_id?: string | null
          note?: string | null
          reservation_id?: string | null
          source_ref?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_ledger_lot_id_fkey"
            columns: ["lot_id"]
            isOneToOne: false
            referencedRelation: "credit_lots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_ledger_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      credit_lots: {
        Row: {
          available_units: number
          created_at: string
          expired_units: number
          expires_at: string | null
          funding_ref: string | null
          granted_units: number
          id: string
          note: string | null
          reserved_units: number
          restricted: boolean
          revoked_units: number
          source_key: string
          source_kind: string
          spent_units: number
          updated_at: string
          user_id: string
        }
        Insert: {
          available_units?: number
          created_at?: string
          expired_units?: number
          expires_at?: string | null
          funding_ref?: string | null
          granted_units: number
          id?: string
          note?: string | null
          reserved_units?: number
          restricted?: boolean
          revoked_units?: number
          source_key: string
          source_kind: string
          spent_units?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          available_units?: number
          created_at?: string
          expired_units?: number
          expires_at?: string | null
          funding_ref?: string | null
          granted_units?: number
          id?: string
          note?: string | null
          reserved_units?: number
          restricted?: boolean
          revoked_units?: number
          source_key?: string
          source_kind?: string
          spent_units?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_lots_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      credit_reservations: {
        Row: {
          created_at: string
          id: string
          job_id: string
          settled_at: string | null
          settlement_reason: string | null
          state: string
          units: number
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          job_id: string
          settled_at?: string | null
          settlement_reason?: string | null
          state?: string
          units: number
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          job_id?: string
          settled_at?: string | null
          settlement_reason?: string | null
          state?: string
          units?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_reservations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      generation_job_events: {
        Row: {
          created_at: string
          event: string
          id: string
          job_id: string
          message: string
          user_id: string
        }
        Insert: {
          created_at?: string
          event: string
          id?: string
          job_id: string
          message: string
          user_id: string
        }
        Update: {
          created_at?: string
          event?: string
          id?: string
          job_id?: string
          message?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "generation_job_events_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "generation_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      generation_jobs: {
        Row: {
          adapter: string
          adapter_version: number
          capability_version_id: string
          completed_at: string | null
          created_at: string
          customer_deadline_at: string
          delayed_after_at: string
          failure_code: string | null
          failure_message: string | null
          favorite: boolean
          hidden_at: string | null
          id: string
          idempotency_key: string
          model_id: string
          model_name: string
          next_action_at: string | null
          options: Json
          parent_job_id: string | null
          price_version_id: string | null
          prompt: string
          purpose: string
          quote_id: string
          reference_asset_ids: string[]
          request_hash: string
          settlement_state: string
          short_ref: string
          state: string
          state_version: number
          submitted_at: string | null
          title: string
          tool: string
          units: number
          updated_at: string
          user_id: string
        }
        Insert: {
          adapter: string
          adapter_version: number
          capability_version_id: string
          completed_at?: string | null
          created_at?: string
          customer_deadline_at: string
          delayed_after_at: string
          failure_code?: string | null
          failure_message?: string | null
          favorite?: boolean
          hidden_at?: string | null
          id: string
          idempotency_key: string
          model_id: string
          model_name: string
          next_action_at?: string | null
          options: Json
          parent_job_id?: string | null
          price_version_id?: string | null
          prompt: string
          purpose?: string
          quote_id: string
          reference_asset_ids?: string[]
          request_hash: string
          settlement_state?: string
          short_ref?: string
          state?: string
          state_version?: number
          submitted_at?: string | null
          title: string
          tool: string
          units: number
          updated_at?: string
          user_id: string
        }
        Update: {
          adapter?: string
          adapter_version?: number
          capability_version_id?: string
          completed_at?: string | null
          created_at?: string
          customer_deadline_at?: string
          delayed_after_at?: string
          failure_code?: string | null
          failure_message?: string | null
          favorite?: boolean
          hidden_at?: string | null
          id?: string
          idempotency_key?: string
          model_id?: string
          model_name?: string
          next_action_at?: string | null
          options?: Json
          parent_job_id?: string | null
          price_version_id?: string | null
          prompt?: string
          purpose?: string
          quote_id?: string
          reference_asset_ids?: string[]
          request_hash?: string
          settlement_state?: string
          short_ref?: string
          state?: string
          state_version?: number
          submitted_at?: string | null
          title?: string
          tool?: string
          units?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "generation_jobs_parent_job_id_fkey"
            columns: ["parent_job_id"]
            isOneToOne: false
            referencedRelation: "generation_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generation_jobs_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: true
            referencedRelation: "generation_quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generation_jobs_tool_fkey"
            columns: ["tool"]
            isOneToOne: false
            referencedRelation: "tools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generation_jobs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      generation_quotes: {
        Row: {
          capability_version_id: string
          consumed_at: string | null
          created_at: string
          expires_at: string
          id: string
          input_hash: string
          model_id: string
          normalized_input: Json
          price_version_id: string | null
          purpose: string
          tool: string
          units: number
          user_id: string
        }
        Insert: {
          capability_version_id: string
          consumed_at?: string | null
          created_at?: string
          expires_at: string
          id?: string
          input_hash: string
          model_id: string
          normalized_input: Json
          price_version_id?: string | null
          purpose?: string
          tool: string
          units: number
          user_id: string
        }
        Update: {
          capability_version_id?: string
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          input_hash?: string
          model_id?: string
          normalized_input?: Json
          price_version_id?: string | null
          purpose?: string
          tool?: string
          units?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "generation_quotes_tool_fkey"
            columns: ["tool"]
            isOneToOne: false
            referencedRelation: "tools"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "generation_quotes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          event_key: string
          id: string
          kind: string
          link: string | null
          read_at: string | null
          title: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          event_key: string
          id?: string
          kind: string
          link?: string | null
          read_at?: string | null
          title: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          event_key?: string
          id?: string
          kind?: string
          link?: string | null
          read_at?: string | null
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      payment_orders: {
        Row: {
          amount_minor: number
          checkout_url: string | null
          created_at: string
          credits: number
          currency: string
          gateway: string | null
          gateway_checkout_id: string | null
          gateway_payment_id: string | null
          id: string
          idempotency_key: string
          kind: string
          paid_at: string | null
          product_key: string
          product_name: string
          product_version_id: string
          refunded_minor: number
          short_ref: string
          state: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount_minor: number
          checkout_url?: string | null
          created_at?: string
          credits: number
          currency: string
          gateway?: string | null
          gateway_checkout_id?: string | null
          gateway_payment_id?: string | null
          id?: string
          idempotency_key: string
          kind: string
          paid_at?: string | null
          product_key: string
          product_name: string
          product_version_id: string
          refunded_minor?: number
          short_ref?: string
          state?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount_minor?: number
          checkout_url?: string | null
          created_at?: string
          credits?: number
          currency?: string
          gateway?: string | null
          gateway_checkout_id?: string | null
          gateway_payment_id?: string | null
          id?: string
          idempotency_key?: string
          kind?: string
          paid_at?: string | null
          product_key?: string
          product_name?: string
          product_version_id?: string
          refunded_minor?: number
          short_ref?: string
          state?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_orders_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      payout_batches: {
        Row: {
          approved_by: string | null
          created_at: string
          currency: string
          evidence: string | null
          id: string
          method: string
          paid_at: string | null
          prepared_by: string
          short_ref: string
          single_owner_exception: string | null
          state: string
          total_minor: number
          transfer_reference: string | null
          updated_at: string
        }
        Insert: {
          approved_by?: string | null
          created_at?: string
          currency: string
          evidence?: string | null
          id?: string
          method?: string
          paid_at?: string | null
          prepared_by: string
          short_ref?: string
          single_owner_exception?: string | null
          state?: string
          total_minor?: number
          transfer_reference?: string | null
          updated_at?: string
        }
        Update: {
          approved_by?: string | null
          created_at?: string
          currency?: string
          evidence?: string | null
          id?: string
          method?: string
          paid_at?: string | null
          prepared_by?: string
          short_ref?: string
          single_owner_exception?: string | null
          state?: string
          total_minor?: number
          transfer_reference?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      payout_items: {
        Row: {
          active: boolean
          adjustment_id: string | null
          affiliate_id: string
          amount_minor: number
          batch_id: string
          commission_id: string | null
          currency: string
          id: string
        }
        Insert: {
          active?: boolean
          adjustment_id?: string | null
          affiliate_id: string
          amount_minor: number
          batch_id: string
          commission_id?: string | null
          currency: string
          id?: string
        }
        Update: {
          active?: boolean
          adjustment_id?: string | null
          affiliate_id?: string
          amount_minor?: number
          batch_id?: string
          commission_id?: string | null
          currency?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payout_items_adjustment_id_fkey"
            columns: ["adjustment_id"]
            isOneToOne: false
            referencedRelation: "commission_adjustments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payout_items_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "affiliate_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payout_items_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "payout_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payout_items_commission_id_fkey"
            columns: ["commission_id"]
            isOneToOne: false
            referencedRelation: "commission_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          account_status: string
          created_at: string
          display_name: string | null
          email: string | null
          email_notifications: boolean
          goal: string | null
          locale: string
          marketing_opt_in: boolean
          suspension_reason: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          account_status?: string
          created_at?: string
          display_name?: string | null
          email?: string | null
          email_notifications?: boolean
          goal?: string | null
          locale?: string
          marketing_opt_in?: boolean
          suspension_reason?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          account_status?: string
          created_at?: string
          display_name?: string | null
          email?: string | null
          email_notifications?: boolean
          goal?: string | null
          locale?: string
          marketing_opt_in?: boolean
          suspension_reason?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      refund_requests: {
        Row: {
          amount_minor: number
          created_at: string
          currency: string
          gateway_refund_id: string | null
          id: string
          idempotency_key: string
          order_id: string
          reason: string
          requested_by: string | null
          revoke_units: number
          state: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount_minor: number
          created_at?: string
          currency: string
          gateway_refund_id?: string | null
          id?: string
          idempotency_key: string
          order_id: string
          reason: string
          requested_by?: string | null
          revoke_units?: number
          state?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount_minor?: number
          created_at?: string
          currency?: string
          gateway_refund_id?: string | null
          id?: string
          idempotency_key?: string
          order_id?: string
          reason?: string
          requested_by?: string | null
          revoke_units?: number
          state?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "refund_requests_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "payment_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refund_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      share_links: {
        Row: {
          asset_id: string
          created_at: string
          expires_at: string | null
          id: string
          revoked_at: string | null
          token_hash: string
          user_id: string
        }
        Insert: {
          asset_id: string
          created_at?: string
          expires_at?: string | null
          id?: string
          revoked_at?: string | null
          token_hash: string
          user_id: string
        }
        Update: {
          asset_id?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          revoked_at?: string | null
          token_hash?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "share_links_asset_id_user_id_fkey"
            columns: ["asset_id", "user_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          gateway: string
          gateway_subscription_id: string
          id: string
          product_version_id: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          gateway: string
          gateway_subscription_id: string
          id?: string
          product_version_id: string
          status: string
          updated_at?: string
          user_id: string
        }
        Update: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          gateway?: string
          gateway_subscription_id?: string
          id?: string
          product_version_id?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      support_messages: {
        Row: {
          attachment_asset_id: string | null
          author_id: string
          author_role: string
          body: string
          created_at: string
          id: string
          ticket_id: string
        }
        Insert: {
          attachment_asset_id?: string | null
          author_id: string
          author_role: string
          body: string
          created_at?: string
          id?: string
          ticket_id: string
        }
        Update: {
          attachment_asset_id?: string | null
          author_id?: string
          author_role?: string
          body?: string
          created_at?: string
          id?: string
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_messages_attachment_asset_id_fkey"
            columns: ["attachment_asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_messages_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      support_tickets: {
        Row: {
          assigned_to: string | null
          category: string
          created_at: string
          id: string
          job_id: string | null
          order_id: string | null
          priority: string
          short_ref: string
          status: string
          subject: string
          updated_at: string
          user_id: string
        }
        Insert: {
          assigned_to?: string | null
          category: string
          created_at?: string
          id?: string
          job_id?: string | null
          order_id?: string | null
          priority?: string
          short_ref?: string
          status?: string
          subject: string
          updated_at?: string
          user_id: string
        }
        Update: {
          assigned_to?: string | null
          category?: string
          created_at?: string
          id?: string
          job_id?: string | null
          order_id?: string | null
          priority?: string
          short_ref?: string
          status?: string
          subject?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_tickets_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "generation_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_tickets_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "payment_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_tickets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      tools: {
        Row: {
          enabled: boolean
          id: string
          job_kind: string
          label: string
          sort_order: number
        }
        Insert: {
          enabled?: boolean
          id: string
          job_kind: string
          label: string
          sort_order?: number
        }
        Update: {
          enabled?: boolean
          id?: string
          job_kind?: string
          label?: string
          sort_order?: number
        }
        Relationships: []
      }
      upload_intents: {
        Row: {
          asset_id: string | null
          bucket: string
          created_at: string
          expected_bytes: number
          expected_mime: string
          expires_at: string
          id: string
          object_path: string
          original_name: string | null
          purpose: string
          rejection_reason: string | null
          state: string
          user_id: string
        }
        Insert: {
          asset_id?: string | null
          bucket: string
          created_at?: string
          expected_bytes: number
          expected_mime: string
          expires_at: string
          id?: string
          object_path: string
          original_name?: string | null
          purpose: string
          rejection_reason?: string | null
          state?: string
          user_id: string
        }
        Update: {
          asset_id?: string | null
          bucket?: string
          created_at?: string
          expected_bytes?: number
          expected_mime?: string
          expires_at?: string
          id?: string
          object_path?: string
          original_name?: string | null
          purpose?: string
          rejection_reason?: string | null
          state?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "upload_intents_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upload_intents_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      wallet_accounts: {
        Row: {
          available_units: number
          expired_units: number
          reserved_units: number
          restricted: boolean
          restriction_reason: string | null
          revoked_units: number
          spent_units: number
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          available_units?: number
          expired_units?: number
          reserved_units?: number
          restricted?: boolean
          restriction_reason?: string | null
          revoked_units?: number
          spent_units?: number
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          available_units?: number
          expired_units?: number
          reserved_units?: number
          restricted?: boolean
          restriction_reason?: string | null
          revoked_units?: number
          spent_units?: number
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "wallet_accounts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      add_support_message: {
        Args: { p_body: string; p_ticket_id: string }
        Returns: Json
      }
      admin_adjust_credits: {
        Args: {
          p_category: string
          p_idempotency_key: string
          p_reason: string
          p_units: number
          p_user_id: string
        }
        Returns: Json
      }
      admin_audit_log: {
        Args: { p_before?: string; p_limit?: number }
        Returns: Json
      }
      admin_authorize_test_output: {
        Args: { p_asset_id: string }
        Returns: Json
      }
      admin_begin_balance_refresh: { Args: never; Returns: Json }
      admin_bulk_set_availability: {
        Args: {
          p_accept_untested?: boolean
          p_model_ids: string[]
          p_state: string
        }
        Returns: Json
      }
      admin_catalog: { Args: never; Returns: Json }
      admin_create_model_test: {
        Args: {
          p_confirm_spend: boolean
          p_idempotency_key: string
          p_model_id: string
          p_options: Json
          p_prompt: string
          p_reference_asset_ids: string[]
        }
        Returns: Json
      }
      admin_create_price_version: {
        Args: {
          p_evidence: string
          p_model_id: string
          p_rules: Json
          p_supplier_cost: Json
        }
        Returns: Json
      }
      admin_job_action: {
        Args: {
          p_action: string
          p_job_id: string
          p_payload?: Json
          p_reason: string
        }
        Returns: Json
      }
      admin_job_detail: { Args: { p_job: string }; Returns: Json }
      admin_list_affiliates: { Args: { p_state?: string }; Returns: Json }
      admin_list_jobs: {
        Args: {
          p_before?: string
          p_limit?: number
          p_model?: string
          p_q?: string
          p_state?: string
        }
        Returns: Json
      }
      admin_list_payments: {
        Args: { p_before?: string; p_limit?: number; p_state?: string }
        Returns: Json
      }
      admin_list_payout_batches: { Args: never; Returns: Json }
      admin_list_staff: { Args: never; Returns: Json }
      admin_list_tickets: { Args: { p_status?: string }; Returns: Json }
      admin_list_users: {
        Args: { p_before?: string; p_limit?: number; p_q?: string }
        Returns: Json
      }
      admin_me: { Args: never; Returns: Json }
      admin_model_detail: { Args: { p_model_id: string }; Returns: Json }
      admin_overview: { Args: never; Returns: Json }
      admin_package_impact: { Args: { p_changes: Json }; Returns: Json }
      admin_payout_batch_action: {
        Args: {
          p_action: string
          p_batch_id: string
          p_evidence?: string
          p_reason?: string
          p_reference?: string
        }
        Returns: Json
      }
      admin_prepare_payout_batch: {
        Args: { p_currency: string }
        Returns: Json
      }
      admin_prepare_refund: {
        Args: {
          p_amount_minor: number
          p_idempotency_key: string
          p_order_id: string
          p_reason: string
        }
        Returns: Json
      }
      admin_pricing_apply: {
        Args: {
          p_action: string
          p_include_overrides: boolean
          p_markup_percent: number
          p_model_ids: string[]
          p_preview_revision: string
          p_scope: string
          p_selected: string[]
        }
        Returns: Json
      }
      admin_pricing_batches: { Args: { p_limit?: number }; Returns: Json }
      admin_pricing_preview: {
        Args: {
          p_include_overrides?: boolean
          p_markup_percent: number
          p_model_ids: string[]
          p_scope: string
        }
        Returns: Json
      }
      admin_provider_summary: { Args: never; Returns: Json }
      admin_publish_agreement: {
        Args: { p_agreement_id: string; p_reason: string }
        Returns: Json
      }
      admin_publish_price_version: {
        Args: { p_price_version_id: string; p_reason: string }
        Returns: Json
      }
      admin_publish_product_version: {
        Args: { p_product_version_id: string; p_reason: string }
        Returns: Json
      }
      admin_reconciliation: { Args: never; Returns: Json }
      admin_record_model_verification: {
        Args: { p_evidence: string; p_model_id: string }
        Returns: Json
      }
      admin_reply_ticket: {
        Args: { p_body: string; p_status: string; p_ticket_id: string }
        Returns: Json
      }
      admin_restore_price_version: {
        Args: { p_price_version_id: string; p_reason?: string }
        Returns: Json
      }
      admin_retire_product: {
        Args: { p_product_key: string; p_reason: string }
        Returns: Json
      }
      admin_review_affiliate: {
        Args: { p_affiliate_id: string; p_decision: string; p_reason: string }
        Returns: Json
      }
      admin_save_price_draft: {
        Args: {
          p_extra_reference_units?: number
          p_model_id: string
          p_note?: string
          p_units: Json
        }
        Returns: Json
      }
      admin_save_product_draft: {
        Args: {
          p_amount_minor: number
          p_credit_expiry_days: number
          p_credits: number
          p_currency: string
          p_description: string
          p_gateway_mapping: Json
          p_interval: string
          p_kind: string
          p_name: string
          p_product_key: string
        }
        Returns: Json
      }
      admin_save_supplier_cost: {
        Args: {
          p_checked_at: string
          p_extra_reference?: Json
          p_model_id: string
          p_note?: string
          p_rates: Json
          p_source_kind: string
          p_source_url: string
        }
        Returns: Json
      }
      admin_set_account_status: {
        Args: { p_reason: string; p_status: string; p_user_id: string }
        Returns: Json
      }
      admin_set_low_balance_threshold: {
        Args: { p_credits: number }
        Returns: Json
      }
      admin_set_model_availability: {
        Args: {
          p_accept_untested?: boolean
          p_model_id: string
          p_note?: string
          p_publish_price_version_id?: string
          p_reason?: string
          p_state: string
        }
        Returns: Json
      }
      admin_set_model_state: {
        Args: {
          p_model_id: string
          p_note: string
          p_reason: string
          p_state: string
        }
        Returns: Json
      }
      admin_set_pricing_assumptions: {
        Args: {
          p_fee_bps: number
          p_fixed_fee_usd: number
          p_operating_cost_usd: number
        }
        Returns: Json
      }
      admin_set_setting: {
        Args: { p_key: string; p_reason: string; p_value: Json }
        Returns: Json
      }
      admin_set_staff_role: {
        Args: {
          p_active: boolean
          p_email: string
          p_reason: string
          p_role: string
        }
        Returns: Json
      }
      admin_update_model_display: {
        Args: {
          p_badges: string[]
          p_model_id: string
          p_name: string
          p_purpose: string
        }
        Returns: Json
      }
      admin_verify_payout_destination: {
        Args: { p_affiliate_id: string; p_reason: string }
        Returns: Json
      }
      apply_affiliate: { Args: { p_application: Json }; Returns: Json }
      archive_affiliate_link: { Args: { p_link_id: string }; Returns: Json }
      authorize_asset_download: { Args: { p_asset_id: string }; Returns: Json }
      bind_checkout: {
        Args: {
          p_checkout_id: string
          p_checkout_url: string
          p_gateway: string
          p_order_id: string
        }
        Returns: Json
      }
      cancel_queued_generation: { Args: { p_job_id: string }; Returns: Json }
      create_affiliate_link: {
        Args: {
          p_campaign?: string
          p_channel?: string
          p_destination: string
          p_sub_id?: string
        }
        Returns: Json
      }
      create_checkout_order: {
        Args: { p_idempotency_key: string; p_product_key: string }
        Returns: Json
      }
      create_generation: {
        Args: { p_idempotency_key: string; p_quote_id: string }
        Returns: Json
      }
      create_generation_quote: {
        Args: {
          p_model_id: string
          p_options?: Json
          p_prompt: string
          p_reference_asset_ids?: string[]
        }
        Returns: Json
      }
      create_share_link: {
        Args: {
          p_asset_id: string
          p_expires_at?: string
          p_token_hash: string
        }
        Returns: Json
      }
      create_support_ticket: {
        Args: {
          p_body: string
          p_category: string
          p_job_id?: string
          p_order_id?: string
          p_subject: string
        }
        Returns: Json
      }
      create_upload_intent: {
        Args: {
          p_bytes: number
          p_mime: string
          p_name?: string
          p_purpose: string
        }
        Returns: Json
      }
      finalize_upload: {
        Args: { p_intent_id: string; p_verified: Json }
        Returns: Json
      }
      get_affiliate_overview: { Args: never; Returns: Json }
      get_billing_overview: { Args: never; Returns: Json }
      get_catalog: { Args: never; Returns: Json }
      get_credit_statement: {
        Args: { p_before?: string; p_limit?: number }
        Returns: Json
      }
      get_generation: { Args: { p_job_id: string }; Returns: Json }
      get_order: { Args: { p_order_id: string }; Returns: Json }
      get_order_for_checkout: { Args: { p_order_id: string }; Returns: Json }
      get_products: { Args: never; Returns: Json }
      get_wallet: { Args: never; Returns: Json }
      list_affiliate_commissions: { Args: never; Returns: Json }
      list_affiliate_links: { Args: never; Returns: Json }
      list_affiliate_payouts: { Args: never; Returns: Json }
      list_affiliate_referrals: { Args: never; Returns: Json }
      list_generations: {
        Args: {
          p_before?: string
          p_favorites?: boolean
          p_limit?: number
          p_state?: string
          p_tool?: string
        }
        Returns: Json
      }
      list_my_tickets: { Args: never; Returns: Json }
      mark_notifications_read: { Args: { p_ids?: string[] }; Returns: number }
      my_capabilities: { Args: never; Returns: string[] }
      provider_callback_receipt: {
        Args: {
          p_attempt_hint?: string
          p_correlation_hash?: string
          p_signature_fingerprint: string
          p_task_id: string
          p_timestamp: string
        }
        Returns: Json
      }
      reconcile_wallets: { Args: never; Returns: Json }
      record_billing_receipt: {
        Args: {
          p_event_id: string
          p_event_type: string
          p_gateway: string
          p_normalized: Json
        }
        Returns: Json
      }
      record_provider_balance: {
        Args: { p_balance: number }
        Returns: undefined
      }
      record_provider_balance_result: {
        Args: {
          p_credits: number
          p_error: string
          p_ok: boolean
          p_source: string
        }
        Returns: undefined
      }
      record_referral_click: {
        Args: {
          p_consent: boolean
          p_referrer_host?: string
          p_slug: string
          p_utm?: Json
        }
        Returns: Json
      }
      record_refund_submission: {
        Args: {
          p_gateway_refund_id: string
          p_refund_request_id: string
          p_state: string
        }
        Returns: Json
      }
      request_asset_deletion: { Args: { p_asset_id: string }; Returns: Json }
      resolve_share_link: { Args: { p_token_hash: string }; Returns: Json }
      revoke_share_link: { Args: { p_share_id: string }; Returns: Json }
      set_collection_membership: {
        Args: { p_asset_id: string; p_collection_id: string; p_member: boolean }
        Returns: Json
      }
      set_generation_flags: {
        Args: { p_favorite?: boolean; p_hidden?: boolean; p_job_id: string }
        Returns: Json
      }
      set_payout_destination: {
        Args: { p_display_hint: string; p_method: string }
        Returns: Json
      }
      system_health: { Args: never; Returns: Json }
      update_my_profile: { Args: { p_patch: Json }; Returns: Json }
      upsert_collection: {
        Args: { p_collection_id?: string; p_name: string }
        Returns: Json
      }
      watchdog_maintenance: { Args: never; Returns: Json }
      watchdog_tick: { Args: never; Returns: Json }
      worker_apply_billing: {
        Args: { p_lease_token: string; p_work_item_id: string }
        Returns: Json
      }
      worker_asset_deleted: {
        Args: {
          p_error?: string
          p_lease_token: string
          p_ok: boolean
          p_work_item_id: string
        }
        Returns: Json
      }
      worker_begin_submission: {
        Args: { p_lease_token: string; p_work_item_id: string }
        Returns: Json
      }
      worker_bind_task:
        | {
            Args: {
              p_evidence: string
              p_lease_token: string
              p_observed_attempt: string
              p_observed_correlation: string
              p_work_item_id: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_evidence: string
              p_lease_token: string
              p_verified: boolean
              p_work_item_id: string
            }
            Returns: Json
          }
      worker_claim: {
        Args: {
          p_msg_id: number
          p_queue: string
          p_work_item_id: string
          p_worker: string
        }
        Returns: Json
      }
      worker_complete: {
        Args: { p_lease_token: string; p_note?: string; p_work_item_id: string }
        Returns: Json
      }
      worker_defer: {
        Args: {
          p_error: string
          p_lease_token: string
          p_seconds: number
          p_work_item_id: string
        }
        Returns: Json
      }
      worker_dequeue: {
        Args: { p_qty?: number; p_queue: string; p_visibility_seconds?: number }
        Returns: Json
      }
      worker_import_failed: {
        Args: {
          p_error: string
          p_lease_token: string
          p_retryable: boolean
          p_work_item_id: string
        }
        Returns: Json
      }
      worker_record_import: {
        Args: { p_assets: Json; p_lease_token: string; p_work_item_id: string }
        Returns: Json
      }
      worker_record_observation: {
        Args: { p_lease_token: string; p_obs: Json; p_work_item_id: string }
        Returns: Json
      }
      worker_record_submission: {
        Args: {
          p_attempt_id: string
          p_lease_token: string
          p_outcome: Json
          p_work_item_id: string
        }
        Returns: Json
      }
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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

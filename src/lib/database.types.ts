export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

type Relationship = {
  foreignKeyName: string;
  columns: string[];
  isOneToOne: boolean;
  referencedRelation: string;
  referencedColumns: string[];
};

type Table<
  Row,
  Insert,
  Update,
  Relationships extends Relationship[] = [],
> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: Relationships;
};

type ProfileRow = {
  id: string;
  first_name: string;
  last_name: string;
  phone_number: string | null;
  email: string;
  requested_role_id: string | null;
  role_id: string | null;
  status: Database["public"]["Enums"]["account_status"];
  reject_reason: string | null;
  approved_by: string | null;
  approved_at: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type Database = {
  public: {
    Tables: {
      shifts: Table<
        {
          id: string;
          name: string;
          start_time: string;
          end_time: string;
          days: number[];
          active: boolean;
        },
        {
          id?: string;
          name: string;
          start_time: string;
          end_time: string;
          days?: number[];
          active?: boolean;
        },
        {
          id?: string;
          name?: string;
          start_time?: string;
          end_time?: string;
          days?: number[];
          active?: boolean;
        }
      >;
      shift_assignments: Table<
        {
          id: string;
          shift_id: string;
          user_id: string;
          work_date: string;
          canceled_at: string | null;
        },
        {
          id?: string;
          shift_id: string;
          user_id: string;
          work_date: string;
          canceled_at?: string | null;
        },
        {
          id?: string;
          shift_id?: string;
          user_id?: string;
          work_date?: string;
          canceled_at?: string | null;
        }
      >;
      shift_sessions: Table<
        {
          id: string;
          user_id: string;
          opened_at: string;
          closed_at: string | null;
          opening_cash: number;
          closing_cash: number | null;
          note: string | null;
          created_at: string;
          shift_id: string | null;
          cash_expected: number | null;
          cash_counted: number | null;
        },
        {
          id?: string;
          user_id?: string;
          opened_at?: string;
          closed_at?: string | null;
          opening_cash: number;
          closing_cash?: number | null;
          note?: string | null;
          created_at?: string;
          shift_id?: string | null;
          cash_expected?: number | null;
          cash_counted?: number | null;
        },
        {
          id?: string;
          user_id?: string;
          opened_at?: string;
          closed_at?: string | null;
          opening_cash?: number;
          closing_cash?: number | null;
          note?: string | null;
          created_at?: string;
          shift_id?: string | null;
          cash_expected?: number | null;
          cash_counted?: number | null;
        }
      >;
      bookings: Table<
        {
          id: string;
          customer_id: string;
          resource_id: string;
          starts_at: string;
          ends_at: string;
          people: number;
          notes: string | null;
          deposit: number;
          status: string;
          cancel_reason: string | null;
          reminded_at: string | null;
          created_by: string | null;
          created_at: string;
        },
        {
          id?: string;
          customer_id: string;
          resource_id: string;
          starts_at: string;
          ends_at: string;
          people?: number;
          notes?: string | null;
          deposit?: number;
          status?: string;
          cancel_reason?: string | null;
          reminded_at?: string | null;
          created_by?: string | null;
          created_at?: string;
        },
        {
          id?: string;
          customer_id?: string;
          resource_id?: string;
          starts_at?: string;
          ends_at?: string;
          people?: number;
          notes?: string | null;
          deposit?: number;
          status?: string;
          cancel_reason?: string | null;
          reminded_at?: string | null;
          created_by?: string | null;
          created_at?: string;
        },
        [
          {
            foreignKeyName: "bookings_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bookings_resource_id_fkey";
            columns: ["resource_id"];
            isOneToOne: false;
            referencedRelation: "resources";
            referencedColumns: ["id"];
          },
        ]
      >;
      roles: Table<
        {
          id: string;
          name: string;
          is_system: boolean;
          is_registrable: boolean;
          created_at: string;
        },
        {
          id?: string;
          name: string;
          is_system?: boolean;
          is_registrable?: boolean;
          created_at?: string;
        },
        {
          id?: string;
          name?: string;
          is_system?: boolean;
          is_registrable?: boolean;
          created_at?: string;
        }
      >;
      permissions: Table<
        { key: string; description: string | null },
        { key: string; description?: string | null },
        { key?: string; description?: string | null }
      >;
      role_permissions: Table<
        { role_id: string; permission_key: string },
        { role_id: string; permission_key: string },
        { role_id?: string; permission_key?: string },
        [
          {
            foreignKeyName: "role_permissions_permission_key_fkey";
            columns: ["permission_key"];
            isOneToOne: false;
            referencedRelation: "permissions";
            referencedColumns: ["key"];
          },
          {
            foreignKeyName: "role_permissions_role_id_fkey";
            columns: ["role_id"];
            isOneToOne: false;
            referencedRelation: "roles";
            referencedColumns: ["id"];
          },
        ]
      >;
      profiles: Table<
        ProfileRow,
        {
          id: string;
          first_name: string;
          last_name: string;
          phone_number?: string | null;
          email: string;
          requested_role_id?: string | null;
          role_id?: string | null;
          status?: Database["public"]["Enums"]["account_status"];
          reject_reason?: string | null;
          approved_by?: string | null;
          approved_at?: string | null;
          deleted_at?: string | null;
          created_at?: string;
          updated_at?: string;
        },
        {
          id?: string;
          first_name?: string;
          last_name?: string;
          phone_number?: string | null;
          email?: string;
          requested_role_id?: string | null;
          role_id?: string | null;
          status?: Database["public"]["Enums"]["account_status"];
          reject_reason?: string | null;
          approved_by?: string | null;
          approved_at?: string | null;
          deleted_at?: string | null;
          created_at?: string;
          updated_at?: string;
        },
        [
          {
            foreignKeyName: "profiles_approved_by_fkey";
            columns: ["approved_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "profiles_requested_role_id_fkey";
            columns: ["requested_role_id"];
            isOneToOne: false;
            referencedRelation: "roles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "profiles_role_id_fkey";
            columns: ["role_id"];
            isOneToOne: false;
            referencedRelation: "roles";
            referencedColumns: ["id"];
          },
        ]
      >;
      notifications: Table<
        {
          id: string;
          user_id: string;
          type: string;
          payload: Json;
          read_at: string | null;
          created_at: string;
        },
        {
          id?: string;
          user_id: string;
          type: string;
          payload?: Json;
          read_at?: string | null;
          created_at?: string;
        },
        {
          id?: string;
          user_id?: string;
          type?: string;
          payload?: Json;
          read_at?: string | null;
          created_at?: string;
        },
        [
          {
            foreignKeyName: "notifications_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ]
      >;
      settings: Table<
        {
          key: string;
          value: Json;
          updated_by: string | null;
          updated_at: string;
        },
        {
          key: string;
          value: Json;
          updated_by?: string | null;
          updated_at?: string;
        },
        {
          key?: string;
          value?: Json;
          updated_by?: string | null;
          updated_at?: string;
        },
        [
          {
            foreignKeyName: "settings_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ]
      >;
      imports: Table<
        {
          id: string;
          user_id: string | null;
          created_by: string | null;
          filename: string | null;
          total: number;
          created: number;
          updated: number;
          skipped: number;
          failed: number;
          rolled_back_at: string | null;
          created_at: string;
        },
        {
          id?: string;
          user_id?: string | null;
          created_by?: string | null;
          filename?: string | null;
          total?: number;
          created?: number;
          updated?: number;
          skipped?: number;
          failed?: number;
          rolled_back_at?: string | null;
          created_at?: string;
        },
        {
          id?: string;
          user_id?: string | null;
          created_by?: string | null;
          filename?: string | null;
          total?: number;
          created?: number;
          updated?: number;
          skipped?: number;
          failed?: number;
          rolled_back_at?: string | null;
          created_at?: string;
        },
        [
          {
            foreignKeyName: "imports_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "imports_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ]
      >;
      student_types: Table<
        {
          id: string;
          name_en: string;
          name_ar: string;
          is_active: boolean;
          created_at: string;
        },
        {
          id?: string;
          name_en: string;
          name_ar: string;
          is_active?: boolean;
          created_at?: string;
        },
        {
          id?: string;
          name_en?: string;
          name_ar?: string;
          is_active?: boolean;
          created_at?: string;
        }
      >;
      customers: Table<
        {
          id: string;
          code: string;
          first_name: string;
          last_name: string;
          full_name: string;
          birth_date: string;
          student_type_id: string;
          phone: string | null;
          expiry_date: string | null;
          notes: string | null;
          status: Database["public"]["Enums"]["customer_status"];
          qr_token: string;
          import_id: string | null;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
        },
        {
          id?: string;
          code?: string;
          first_name: string;
          last_name: string;
          full_name?: never;
          birth_date: string;
          student_type_id: string;
          phone?: string | null;
          expiry_date?: string | null;
          notes?: string | null;
          status?: Database["public"]["Enums"]["customer_status"];
          qr_token?: string;
          import_id?: string | null;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        },
        {
          id?: string;
          code?: string;
          first_name?: string;
          last_name?: string;
          full_name?: never;
          birth_date?: string;
          student_type_id?: string;
          phone?: string | null;
          expiry_date?: string | null;
          notes?: string | null;
          status?: Database["public"]["Enums"]["customer_status"];
          qr_token?: string;
          import_id?: string | null;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        },
        [
          {
            foreignKeyName: "customers_student_type_id_fkey";
            columns: ["student_type_id"];
            isOneToOne: false;
            referencedRelation: "student_types";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customers_import_id_fkey";
            columns: ["import_id"];
            isOneToOne: false;
            referencedRelation: "imports";
            referencedColumns: ["id"];
          },
        ]
      >;
      checkins: Table<
        {
          id: number;
          customer_id: string;
          resource_id: string | null;
          checked_in_at: string;
          timer_started_at: string;
          last_qualifying_order_at: string | null;
          checked_out_at: string | null;
          scanned_by: string | null;
          created_by: string | null;
          closed_by: string | null;
        },
        {
          id?: never;
          customer_id: string;
          resource_id?: string | null;
          checked_in_at?: string;
          timer_started_at?: string;
          last_qualifying_order_at?: string | null;
          checked_out_at?: string | null;
          scanned_by?: string | null;
          created_by?: string | null;
          closed_by?: string | null;
        },
        {
          id?: never;
          customer_id?: string;
          resource_id?: string | null;
          checked_in_at?: string;
          timer_started_at?: string;
          last_qualifying_order_at?: string | null;
          checked_out_at?: string | null;
          scanned_by?: string | null;
          created_by?: string | null;
          closed_by?: string | null;
        },
        [
          {
            foreignKeyName: "checkins_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "checkins_scanned_by_fkey";
            columns: ["scanned_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "checkins_resource_id_fkey";
            columns: ["resource_id"];
            isOneToOne: false;
            referencedRelation: "resources";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "checkins_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "checkins_closed_by_fkey";
            columns: ["closed_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ]
      >;
      orders: Table<
        {
          id: string;
          number: number;
          customer_id: string;
          description: string;
          subtotal: number;
          discount: number;
          service_charge: number;
          tax: number;
          total: number;
          status: string;
          counts_for_minimum: boolean;
          receipt_id: string | null;
          created_by: string | null;
          created_at: string;
          cancelled_by: string | null;
          cancelled_at: string | null;
          cancel_reason: string | null;
          shift_session_id: string | null;
        },
        Partial<{
          id: string;
          number: number;
          customer_id: string;
          description: string;
          subtotal: number;
          discount: number;
          service_charge: number;
          tax: number;
          total: number;
          status: string;
          counts_for_minimum: boolean;
          receipt_id: string | null;
          created_by: string | null;
          created_at: string;
          cancelled_by: string | null;
          cancelled_at: string | null;
          cancel_reason: string | null;
          shift_session_id: string | null;
        }>,
        Partial<{
          id: string;
          number: number;
          customer_id: string;
          description: string;
          subtotal: number;
          discount: number;
          service_charge: number;
          tax: number;
          total: number;
          status: string;
          counts_for_minimum: boolean;
          receipt_id: string | null;
          created_by: string | null;
          created_at: string;
          cancelled_by: string | null;
          cancelled_at: string | null;
          cancel_reason: string | null;
          shift_session_id: string | null;
        }>
      >;
      fees: Table<
        {
          id: string;
          checkin_id: number;
          customer_id: string;
          cycle_start: string;
          block_number: number;
          amount: number;
          status: "due" | "paid" | "waived";
          waived_by: string | null;
          waive_reason: string | null;
          receipt_id: string | null;
          paid_at: string | null;
          created_at: string;
        },
        Partial<{
          id: string;
          checkin_id: number;
          customer_id: string;
          cycle_start: string;
          block_number: number;
          amount: number;
          status: "due" | "paid" | "waived";
          waived_by: string | null;
          waive_reason: string | null;
          receipt_id: string | null;
          paid_at: string | null;
          created_at: string;
        }>,
        Partial<{
          id: string;
          checkin_id: number;
          customer_id: string;
          cycle_start: string;
          block_number: number;
          amount: number;
          status: "due" | "paid" | "waived";
          waived_by: string | null;
          waive_reason: string | null;
          receipt_id: string | null;
          paid_at: string | null;
          created_at: string;
        }>
      >;
      receipts: Table<
        {
          id: string;
          number: number;
          customer_id: string;
          subtotal: number;
          discount: number;
          service_charge: number;
          tax: number;
          total: number;
          method: "cash" | "card" | "wallet" | "other";
          status: "paid" | "voided";
          amount_received: number | null;
          shift_session_id: string | null;
          note: string | null;
          created_by: string | null;
          created_at: string;
          voided_by: string | null;
          voided_at: string | null;
          void_reason: string | null;
        },
        Partial<{
          id: string;
          number: number;
          customer_id: string;
          subtotal: number;
          discount: number;
          service_charge: number;
          tax: number;
          total: number;
          method: "cash" | "card" | "wallet" | "other";
          status: "paid" | "voided";
          amount_received: number | null;
          shift_session_id: string | null;
          note: string | null;
          created_by: string | null;
          created_at: string;
          voided_by: string | null;
          voided_at: string | null;
          void_reason: string | null;
        }>,
        Partial<{
          id: string;
          number: number;
          customer_id: string;
          subtotal: number;
          discount: number;
          service_charge: number;
          tax: number;
          total: number;
          method: "cash" | "card" | "wallet" | "other";
          status: "paid" | "voided";
          amount_received: number | null;
          shift_session_id: string | null;
          note: string | null;
          created_by: string | null;
          created_at: string;
          voided_by: string | null;
          voided_at: string | null;
          void_reason: string | null;
        }>
      >;
      receipt_lines: Table<
        {
          id: number;
          receipt_id: string;
          line_type: "order" | "fee";
          order_id: string | null;
          fee_id: string | null;
          description: string;
          amount: number;
        },
        Partial<{
          id: number;
          receipt_id: string;
          line_type: "order" | "fee";
          order_id: string | null;
          fee_id: string | null;
          description: string;
          amount: number;
        }>,
        Partial<{
          id: number;
          receipt_id: string;
          line_type: "order" | "fee";
          order_id: string | null;
          fee_id: string | null;
          description: string;
          amount: number;
        }>
      >;
      pos_menu_categories: Table<
        {
          id: string;
          name_en: string;
          name_ar: string;
          sort: number;
          active: boolean;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          name_en: string;
          name_ar: string;
          sort?: number;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        },
        {
          id?: string;
          name_en?: string;
          name_ar?: string;
          sort?: number;
          active?: boolean;
          updated_at?: string;
        }
      >;
      pos_products: Table<
        {
          id: string;
          category_id: string | null;
          name_en: string;
          name_ar: string;
          description: string | null;
          price: number;
          qualifies_for_time: boolean;
          active: boolean;
          available: boolean;
          image_path: string | null;
          sort: number;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          category_id?: string | null;
          name_en: string;
          name_ar: string;
          description?: string | null;
          price: number;
          qualifies_for_time?: boolean;
          active?: boolean;
          available?: boolean;
          image_path?: string | null;
          sort?: number;
          created_at?: string;
          updated_at?: string;
        },
        {
          id?: string;
          category_id?: string | null;
          name_en?: string;
          name_ar?: string;
          description?: string | null;
          price?: number;
          qualifies_for_time?: boolean;
          active?: boolean;
          available?: boolean;
          image_path?: string | null;
          sort?: number;
          updated_at?: string;
        },
        [
          {
            foreignKeyName: "pos_products_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "pos_menu_categories";
            referencedColumns: ["id"];
          },
        ]
      >;
      resources: Table<
        {
          id: string;
          type: "seat" | "room" | "table";
          name: string;
          capacity: number;
          status: "available" | "maintenance";
          active: boolean;
          created_at: string;
        },
        {
          id?: string;
          type: "seat" | "room" | "table";
          name: string;
          capacity?: number;
          status?: "available" | "maintenance";
          active?: boolean;
          created_at?: string;
        },
        {
          id?: string;
          type?: "seat" | "room" | "table";
          name?: string;
          capacity?: number;
          status?: "available" | "maintenance";
          active?: boolean;
          created_at?: string;
        }
      >;
      inventory_items: Table<
        {
          id: string;
          name: string;
          unit: string;
          qty: number;
          min_qty: number;
          active: boolean;
          created_at: string;
        },
        {
          id?: string;
          name: string;
          unit?: string;
          qty?: number;
          min_qty?: number;
          active?: boolean;
          created_at?: string;
        },
        {
          id?: string;
          name?: string;
          unit?: string;
          qty?: number;
          min_qty?: number;
          active?: boolean;
          created_at?: string;
        }
      >;
      inventory_movements: Table<
        {
          id: number;
          item_id: string;
          change: number;
          qty_after: number;
          reason: string;
          created_by: string | null;
          created_at: string;
        },
        {
          id?: never;
          item_id: string;
          change: number;
          qty_after: number;
          reason: string;
          created_by?: string | null;
          created_at?: string;
        },
        {
          id?: never;
          item_id?: string;
          change?: number;
          qty_after?: number;
          reason?: string;
          created_by?: string | null;
          created_at?: string;
        }
      >;
      scan_logs: Table<
        {
          id: number;
          created_at: string;
          user_id: string | null;
          customer_id: string | null;
          input_hint: string | null;
          result: "ok" | "blocked" | "expired" | "unknown";
        },
        {
          id?: never;
          created_at?: string;
          user_id?: string | null;
          customer_id?: string | null;
          input_hint?: string | null;
          result: "ok" | "blocked" | "expired" | "unknown";
        },
        {
          id?: never;
          created_at?: string;
          user_id?: string | null;
          customer_id?: string | null;
          input_hint?: string | null;
          result?: "ok" | "blocked" | "expired" | "unknown";
        }
      >;
      qc_templates: Table<
        {
          id: string;
          name: string;
          area: string | null;
          frequency: "per_shift" | "daily";
          due_time: string | null;
          active: boolean;
          created_at: string;
        },
        {
          id?: string;
          name: string;
          area?: string | null;
          frequency?: "per_shift" | "daily";
          due_time?: string | null;
          active?: boolean;
          created_at?: string;
        },
        {
          id?: string;
          name?: string;
          area?: string | null;
          frequency?: "per_shift" | "daily";
          due_time?: string | null;
          active?: boolean;
          created_at?: string;
        }
      >;
      qc_template_items: Table<
        {
          id: string;
          template_id: string;
          text: string;
          critical: boolean;
          sort: number;
          active: boolean;
        },
        {
          id?: string;
          template_id: string;
          text: string;
          critical?: boolean;
          sort?: number;
          active?: boolean;
        },
        {
          id?: string;
          template_id?: string;
          text?: string;
          critical?: boolean;
          sort?: number;
          active?: boolean;
        }
      >;
      qc_submissions: Table<
        {
          id: string;
          template_id: string;
          user_id: string;
          shift_session_id: string | null;
          submitted_at: string;
          total_items: number;
          passed_items: number;
          score: number;
          reviewed_by: string | null;
          reviewed_at: string | null;
          review_score: number | null;
          review_note: string | null;
        },
        {
          id?: string;
          template_id: string;
          user_id: string;
          shift_session_id?: string | null;
          submitted_at?: string;
          total_items: number;
          passed_items: number;
          score: number;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          review_score?: number | null;
          review_note?: string | null;
        },
        {
          id?: string;
          template_id?: string;
          user_id?: string;
          shift_session_id?: string | null;
          submitted_at?: string;
          total_items?: number;
          passed_items?: number;
          score?: number;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          review_score?: number | null;
          review_note?: string | null;
        }
      >;
      qc_answers: Table<
        {
          id: number;
          submission_id: string;
          item_id: string | null;
          item_text: string;
          critical: boolean;
          passed: boolean;
          note: string | null;
          photo_path: string | null;
        },
        {
          id?: never;
          submission_id: string;
          item_id?: string | null;
          item_text: string;
          critical: boolean;
          passed: boolean;
          note?: string | null;
          photo_path?: string | null;
        },
        {
          id?: never;
          submission_id?: string;
          item_id?: string | null;
          item_text?: string;
          critical?: boolean;
          passed?: boolean;
          note?: string | null;
          photo_path?: string | null;
        }
      >;
      feedback: Table<
        {
          id: string;
          customer_id: string | null;
          rating: number;
          comment: string | null;
          created_by: string | null;
          created_at: string;
        },
        {
          id?: string;
          customer_id?: string | null;
          rating: number;
          comment?: string | null;
          created_by?: string | null;
          created_at?: string;
        },
        {
          id?: string;
          customer_id?: string | null;
          rating?: number;
          comment?: string | null;
          created_by?: string | null;
          created_at?: string;
        }
      >;
      alerts: Table<
        {
          id: string;
          type: string;
          severity: "low" | "medium" | "high" | "critical";
          title: string;
          detail: Json;
          source_key: string;
          status: "open" | "acknowledged" | "snoozed" | "resolved";
          snoozed_until: string | null;
          acknowledged_by: string | null;
          acknowledged_at: string | null;
          assigned_to: string | null;
          created_at: string;
          resolved_at: string | null;
        },
        {
          id?: string;
          type: string;
          severity: "low" | "medium" | "high" | "critical";
          title: string;
          detail?: Json;
          source_key: string;
          status?: "open" | "acknowledged" | "snoozed" | "resolved";
          snoozed_until?: string | null;
          acknowledged_by?: string | null;
          acknowledged_at?: string | null;
          assigned_to?: string | null;
          created_at?: string;
          resolved_at?: string | null;
        },
        {
          id?: string;
          type?: string;
          severity?: "low" | "medium" | "high" | "critical";
          title?: string;
          detail?: Json;
          source_key?: string;
          status?: "open" | "acknowledged" | "snoozed" | "resolved";
          snoozed_until?: string | null;
          acknowledged_by?: string | null;
          acknowledged_at?: string | null;
          assigned_to?: string | null;
          created_at?: string;
          resolved_at?: string | null;
        }
      >;
      incidents: Table<
        {
          id: string;
          number: number;
          type: "equipment" | "customer" | "cash" | "safety" | "cleaning" | "quality" | "power_internet" | "other";
          severity: "low" | "medium" | "high" | "critical";
          status: "open" | "assigned" | "in_progress" | "resolved" | "closed";
          title: string;
          description: string | null;
          location: string | null;
          reported_by: string | null;
          assigned_to: string | null;
          photo_paths: string[];
          source: string;
          qc_submission_id: string | null;
          resolution_note: string | null;
          resolved_at: string | null;
          closed_at: string | null;
          created_at: string;
        },
        Record<string, never>,
        Record<string, never>
      >;
      incident_events: Table<
        {
          id: number;
          incident_id: string;
          user_id: string | null;
          kind: "created" | "comment" | "status" | "assign";
          body: string | null;
          created_at: string;
        },
        Record<string, never>,
        Record<string, never>
      >;
    };
    Views: Record<string, never>;
    Functions: {
      dashboard_summary: {
        Args: { p_from: string; p_to: string };
        Returns: Json;
      };
      occupancy_now: {
        Args: Record<string, never>;
        Returns: {
          resource_id: string;
          name: string;
          type: string;
          capacity: number;
          status: string;
          people: number;
          names: string[] | null;
        }[];
      };
      revenue_by_hour: {
        Args: { p_day: string };
        Returns: { hr: number; revenue: number; receipts_count: number }[];
      };
      revenue_by_day: {
        Args: { p_from: string; p_to: string };
        Returns: { day_date: string; revenue: number; fees: number; receipts_count: number }[];
      };
      top_items: {
        Args: { p_from: string; p_to: string; p_limit?: number; p_language?: string };
        Returns: { item_name: string; qty: number; revenue: number }[];
      };
      orders_per_user: {
        Args: { p_from: string; p_to: string };
        Returns: { user_name: string; orders_count: number; total: number }[];
      };
      occupancy_by_hour: {
        Args: { p_day: string };
        Returns: { hr: number; people: number | null }[];
      };
      audit_suspicious: {
        Args: { p_days?: number };
        Returns: {
          id: number;
          created_at: string;
          actor_id: string | null;
          actor_name: string | null;
          action: string;
          entity: string | null;
          entity_id: string | null;
          old_value: Json | null;
          new_value: Json | null;
          actor_role: string | null;
          ip: string | null;
          user_agent: string | null;
        }[];
      };
      audit_log_actions: {
        Args: Record<string, never>;
        Returns: { action: string }[];
      };
      audit_log_users: {
        Args: Record<string, never>;
        Returns: {
          user_id: string;
          display_name: string;
          role_name: string | null;
        }[];
      };
      list_audit_logs: {
        Args: {
          p_user?: string | null;
          p_action?: string | null;
          p_entity?: string | null;
          p_from?: string | null;
          p_to?: string | null;
          p_search?: string | null;
          p_limit?: number;
          p_offset?: number;
        };
        Returns: Json;
      };
      list_audit_scans: {
        Args: {
          p_result?: string | null;
          p_limit?: number;
          p_offset?: number;
        };
        Returns: Json;
      };
      dashboard_low_stock_items: {
        Args: Record<string, never>;
        Returns: {
          item_id: string;
          name: string;
          unit: string;
          qty: number;
          min_qty: number;
        }[];
      };
      get_alert_overview: {
        Args: Record<string, never>;
        Returns: {
          active_count: number;
          low_count: number;
          medium_count: number;
          high_count: number;
          critical_count: number;
          critical_unacknowledged: boolean;
        }[];
      };
      get_alert_staff: {
        Args: Record<string, never>;
        Returns: {
          user_id: string;
          first_name: string;
          last_name: string;
          role_name: string | null;
        }[];
      };
      get_alert_shift_session: {
        Args: { p_session: string };
        Returns: {
          session_id: string;
          employee_name: string | null;
          shift_name: string | null;
          opened_at: string;
          closed_at: string | null;
          opening_cash: number;
          closing_cash: number | null;
          cash_expected: number | null;
          cash_counted: number | null;
        }[];
      };
      get_alert_scan_log: {
        Args: { p_alert: string };
        Returns: {
          scan_id: number;
          created_at: string;
          result: "blocked" | "expired" | "unknown";
        }[];
      };
      acknowledge_alert: {
        Args: { p_id: string };
        Returns: undefined;
      };
      assign_alert: {
        Args: { p_id: string; p_user: string };
        Returns: undefined;
      };
      snooze_alert: {
        Args: { p_id: string; p_minutes: number };
        Returns: undefined;
      };
      list_bookings: {
        Args: {
          p_from: string;
          p_to: string;
          p_resource?: string | null;
          p_status?: string | null;
          p_search?: string | null;
        };
        Returns: {
          id: string;
          customer_id: string;
          customer_name: string;
          customer_code: string;
          resource_id: string;
          resource_name: string;
          resource_type: string;
          resource_capacity: number;
          starts_at: string;
          ends_at: string;
          people: number;
          notes: string | null;
          deposit: number;
          status: string;
          cancel_reason: string | null;
          created_by: string | null;
          created_at: string;
        }[];
      };
      get_booking_resources: {
        Args: Record<string, never>;
        Returns: {
          id: string;
          type: string;
          name: string;
          capacity: number;
          status: string;
          occupied: boolean;
        }[];
      };
      get_booking_settings: {
        Args: Record<string, never>;
        Returns: {
          currency_code: string;
          time_zone: string;
        }[];
      };
      search_booking_customers: {
        Args: { p_search: string };
        Returns: {
          id: string;
          first_name: string;
          last_name: string;
          code: string;
        }[];
      };
      create_booking: {
        Args: {
          p_customer: string;
          p_resource: string;
          p_starts: string;
          p_ends: string;
          p_people?: number;
          p_notes?: string | null;
          p_deposit?: number;
        };
        Returns: Database["public"]["Tables"]["bookings"]["Row"];
      };
      update_booking: {
        Args: {
          p_id: string;
          p_resource: string;
          p_starts: string;
          p_ends: string;
          p_people: number;
          p_notes: string | null;
          p_deposit: number;
        };
        Returns: undefined;
      };
      set_booking_status: {
        Args: { p_id: string; p_status: string; p_reason?: string | null };
        Returns: undefined;
      };
      booking_check_in: {
        Args: { p_booking: string };
        Returns: Database["public"]["Tables"]["checkins"]["Row"];
      };
      update_setting: {
        Args: { p_key: string; p_value: Json };
        Returns: undefined;
      };
      save_inventory_item: {
        Args: {
          p_id: string | null;
          p_name: string;
          p_unit: string;
          p_min_qty: number;
          p_active?: boolean;
        };
        Returns: Database["public"]["Tables"]["inventory_items"]["Row"];
      };
      adjust_stock: {
        Args: { p_item: string; p_change: number; p_reason: string };
        Returns: number;
      };
      list_inventory_movements: {
        Args: { p_item: string };
        Returns: {
          id: number;
          created_at: string;
          change: number;
          qty_after: number;
          reason: string;
          created_by: string | null;
          created_by_name: string | null;
        }[];
      };
      create_role: {
        Args: { p_name: string; p_is_registrable: boolean };
        Returns: string;
      };
      rename_role: {
        Args: { p_role: string; p_name: string };
        Returns: undefined;
      };
      delete_role: {
        Args: { p_role: string };
        Returns: undefined;
      };
      set_role_permissions: {
        Args: { p_role: string; p_permissions: string[] };
        Returns: undefined;
      };
      set_role_registrable: {
        Args: { p_role: string; p_is_registrable: boolean };
        Returns: undefined;
      };
      approve_account: {
        Args: { p_user: string; p_role: string };
        Returns: undefined;
      };
      reject_account: {
        Args: { p_user: string; p_reason: string };
        Returns: undefined;
      };
      has_permission: {
        Args: { p_key: string };
        Returns: boolean;
      };
      submit_checklist: {
        Args: { p_template: string; p_answers: Json };
        Returns: Database["public"]["Tables"]["qc_submissions"]["Row"];
      };
      review_submission: {
        Args: { p_id: string; p_score: number; p_note?: string | null };
        Returns: undefined;
      };
      add_feedback: {
        Args: { p_customer: string | null; p_rating: number; p_comment?: string | null };
        Returns: undefined;
      };
      get_quality_feedback_summary: {
        Args: Record<string, never>;
        Returns: Array<{
          average_rating: number;
          feedback_count: number;
          latest_comments: Json;
        }>;
      };
      get_qc_employee_names: {
        Args: { p_user_ids: string[] };
        Returns: Array<{
          user_id: string;
          first_name: string;
          last_name: string;
        }>;
      };
      get_qc_shift_names: {
        Args: { p_shift_session_ids: string[] };
        Returns: Array<{
          shift_session_id: string;
          shift_name: string | null;
        }>;
      };
      report_incident: {
        Args: {
          p_type: string;
          p_severity: string;
          p_title: string;
          p_description?: string | null;
          p_location?: string | null;
          p_photos?: string[];
        };
        Returns: Database["public"]["Tables"]["incidents"]["Row"];
      };
      assign_incident: {
        Args: { p_id: string; p_user: string };
        Returns: undefined;
      };
      update_incident_status: {
        Args: { p_id: string; p_status: string; p_note?: string | null };
        Returns: undefined;
      };
      add_incident_comment: {
        Args: { p_id: string; p_body: string };
        Returns: undefined;
      };
      get_incident_timeline: {
        Args: { p_id: string };
        Returns: Array<{
          event_id: number;
          kind: "created" | "comment" | "status" | "assign";
          body: string | null;
          created_at: string;
          actor_name: string | null;
          assigned_name: string | null;
        }>;
      };
      get_incident_staff: {
        Args: Record<string, never>;
        Returns: Array<{
          user_id: string;
          first_name: string;
          last_name: string;
          role_name: string | null;
        }>;
      };
      get_my_access: {
        Args: Record<string, never>;
        Returns: Json;
      };
      update_employee: {
        Args: {
          p_user: string;
          p_first_name: string;
          p_last_name: string;
          p_role: string;
        };
        Returns: undefined;
      };
      set_employee_status: {
        Args: {
          p_user: string;
          p_status: Database["public"]["Enums"]["account_status"];
        };
        Returns: undefined;
      };
      soft_delete_employee: {
        Args: { p_user: string };
        Returns: undefined;
      };
      create_customer: {
        Args: {
          p_first_name: string;
          p_last_name: string;
          p_birth_date: string;
          p_student_type_id: string;
          p_phone?: string | null;
          p_expiry_date?: string | null;
          p_notes?: string | null;
        };
        Returns: string;
      };
      update_customer: {
        Args: {
          p_customer: string;
          p_first_name: string;
          p_last_name: string;
          p_birth_date: string;
          p_student_type_id: string;
          p_phone?: string | null;
          p_expiry_date?: string | null;
          p_notes?: string | null;
        };
        Returns: undefined;
      };
      set_customer_status: {
        Args: {
          p_customer: string;
          p_status: Database["public"]["Enums"]["customer_status"];
        };
        Returns: undefined;
      };
      soft_delete_customer: {
        Args: { p_customer: string };
        Returns: undefined;
      };
      reissue_qr_token: {
        Args: { p_customer: string };
        Returns: string;
      };
      get_customer_qr_token: {
        Args: { p_customer: string };
        Returns: string;
      };
      log_card_print: {
        Args: { p_count: number };
        Returns: undefined;
      };
      scan_customer: {
        Args: { p_input: string };
        Returns: Json;
      };
      check_in: {
        Args: { p_customer: string; p_resource?: string | null };
        Returns: Database["public"]["Tables"]["checkins"]["Row"];
      };
      check_out: {
        Args: { p_checkin: number };
        Returns: Json;
      };
      checkout_visit: {
        Args: { p_checkin: number; p_payment_method: string };
        Returns: Json;
      };
      collect_payment: {
        Args: {
          p_customer: string;
          p_order_ids: string[];
          p_fee_ids: string[];
          p_method: "cash" | "card" | "wallet" | "other";
          p_amount_received?: number | null;
          p_note?: string | null;
        };
        Returns: Database["public"]["Tables"]["receipts"]["Row"];
      };
      get_customer_payment_context: {
        Args: { p_customer: string };
        Returns: Json;
      };
      get_live_timers: {
        Args: Record<string, never>;
        Returns: {
          checkin_id: number;
          customer_id: string;
          customer_name: string;
          customer_code: string;
          is_inside: boolean;
          resource_name: string | null;
          checked_in_at: string;
          deadline: string;
          warning_at: string;
          overdue_at: string;
          state: "ok" | "warning" | "overdue";
          seconds_left: number;
          fees_due: number;
          server_now: string;
        }[];
      };
      list_timer_fees: {
        Args: Record<string, never>;
        Returns: Json[];
      };
      pay_timer_fee: {
        Args: { p_fee: string; p_payment_method: string };
        Returns: Json;
      };
      waive_fee: {
        Args: { p_fee: string; p_reason: string };
        Returns: undefined;
      };
      assign_customer_resource: {
        Args: { p_checkin: number; p_resource: string | null };
        Returns: Database["public"]["Tables"]["checkins"]["Row"];
      };
      get_resource_occupancy: {
        Args: Record<string, never>;
        Returns: { resource_id: string; people_inside: number }[];
      };
      import_customers: {
        Args: {
          p_rows: Json;
          p_filename: string;
          p_update_existing?: boolean;
        };
        Returns: {
          import_id: string;
          created: number;
          updated: number;
          skipped: number;
          failed: number;
        };
      };
      rollback_import: {
        Args: { p_import: string };
        Returns: number;
      };
      delete_resource: {
        Args: { p_resource: string };
        Returns: undefined;
      };
      get_pos_settings: {
        Args: Record<string, never>;
        Returns: Json;
      };
      update_pos_settings: {
        Args: {
          p_currency: string;
          p_visit_duration_minutes: number;
          p_fee_interval_minutes: number;
          p_fee_amount: number;
          p_timezone: string;
          p_tax_percent: number;
          p_service_percent: number;
          p_timer_warning_minutes: number;
          p_timer_grace_minutes: number;
          p_fee_repeats: boolean;
          p_timer_reset_on: string;
          p_require_open_shift: boolean;
          p_receipt_prefix: string;
          p_cash_diff_alert: number;
        };
        Returns: Json;
      };
      list_pos_categories: {
        Args: Record<string, never>;
        Returns: Json[];
      };
      save_pos_category: {
        Args: {
          p_id: string | null;
          p_name_en: string;
          p_name_ar: string;
          p_sort: number;
          p_active: boolean;
        };
        Returns: string;
      };
      list_pos_products: {
        Args: Record<string, never>;
        Returns: Json[];
      };
      save_pos_product: {
        Args: {
          p_id: string | null;
          p_name_en: string;
          p_name_ar: string;
          p_price: number;
          p_qualifies_for_time: boolean;
          p_active: boolean;
        };
        Returns: string;
      };
      save_pos_menu_item: {
        Args: {
          p_id: string | null;
          p_category_id: string;
          p_name_en: string;
          p_name_ar: string;
          p_description: string;
          p_price: number;
          p_counts_for_minimum: boolean;
          p_available: boolean;
          p_active: boolean;
          p_image_path: string | null;
          p_sort: number;
        };
        Returns: string;
      };
      get_current_pos_shift: {
        Args: Record<string, never>;
        Returns: Json;
      };
      open_shift: {
        Args: { p_shift?: string | null; p_opening_cash?: number };
        Returns: Database["public"]["Tables"]["shift_sessions"]["Row"];
      };
      close_shift: {
        Args: {
          p_session: string;
          p_cash_counted: number;
          p_note?: string | null;
          p_confirm_unpaid?: boolean;
        };
        Returns: Json;
      };
      get_shift_summary: {
        Args: { p_session: string };
        Returns: Json;
      };
      last_handover_note: {
        Args: Record<string, never>;
        Returns: string | null;
      };
      get_shift_staff: {
        Args: { p_active_only?: boolean };
        Returns: {
          id: string;
          first_name: string;
          last_name: string;
          status: Database["public"]["Enums"]["account_status"];
        }[];
      };
      get_shift_unpaid_orders: {
        Args: { p_session: string };
        Returns: {
          order_id: string;
          order_number: number;
          total: number;
          created_at: string;
        }[];
      };
      open_pos_shift: {
        Args: { p_opening_cash: number; p_schedule_shift: string | null };
        Returns: Json;
      };
      close_pos_shift: {
        Args: { p_shift: string; p_counted_cash: number };
        Returns: Json;
      };
      get_shift_schedule_data: {
        Args: { p_from: string; p_to: string };
        Returns: Json;
      };
      save_scheduled_shift: {
        Args: {
          p_id: string | null;
          p_name: string;
          p_start_time: string;
          p_end_time: string;
          p_days: number[];
          p_active: boolean;
        };
        Returns: string;
      };
      assign_scheduled_shift: {
        Args: { p_shift: string; p_user: string; p_work_date: string };
        Returns: string;
      };
      remove_scheduled_shift_assignment: {
        Args: { p_assignment: string };
        Returns: undefined;
      };
      request_swap: {
        Args: { p_assignment: string; p_target: string };
        Returns: undefined;
      };
      decide_swap: {
        Args: { p_request: string; p_approve: boolean };
        Returns: undefined;
      };
      list_open_pos_visits: {
        Args: Record<string, never>;
        Returns: Json[];
      };
      get_visit_timer: {
        Args: { p_checkin: number };
        Returns: Json;
      };
      list_open_pos_orders: {
        Args: Record<string, never>;
        Returns: Json[];
      };
      create_pos_order: {
        Args: {
          p_customer: string;
          p_checkin: number;
          p_items: Json;
          p_discount_type?: string | null;
          p_discount_value?: number;
          p_discount_reason?: string | null;
        };
        Returns: Json;
      };
      create_order: {
        Args: {
          p_customer: string;
          p_items: Json;
          p_note?: string | null;
          p_discount?: number;
          p_discount_reason?: string | null;
        };
        Returns: Json;
      };
      search_order_customers: {
        Args: { p_query: string };
        Returns: Json[];
      };
      set_pos_order_status: {
        Args: { p_order: string; p_status: string };
        Returns: undefined;
      };
      set_order_status: {
        Args: { p_order: string; p_status: string };
        Returns: undefined;
      };
      list_order_board: {
        Args: Record<string, never>;
        Returns: Json[];
      };
      list_orders: {
        Args: {
          p_from?: string | null;
          p_to?: string | null;
          p_status?: string | null;
          p_search?: string | null;
          p_unpaid_only?: boolean;
        };
        Returns: Json[];
      };
      get_order_detail: {
        Args: { p_order: string };
        Returns: Json;
      };
      cancel_order: {
        Args: { p_order: string; p_reason: string };
        Returns: undefined;
      };
      complete_pos_order: {
        Args: { p_order: string; p_payment_method: string };
        Returns: Json;
      };
      cancel_pos_order: {
        Args: { p_order: string; p_reason: string };
        Returns: undefined;
      };
      void_pos_receipt: {
        Args: { p_receipt: string; p_reason: string };
        Returns: undefined;
      };
      list_pos_receipts: {
        Args: Record<string, never>;
        Returns: Json[];
      };
      list_visit_fees: {
        Args: Record<string, never>;
        Returns: Json[];
      };
      waive_visit_fee: {
        Args: { p_fee: string; p_reason: string };
        Returns: undefined;
      };
      pay_visit_fee: {
        Args: { p_fee: string; p_payment_method: string };
        Returns: Json;
      };
      set_customer_loyalty_pin: {
        Args: { p_customer: string; p_pin: string };
        Returns: undefined;
      };
      customer_loyalty_login: {
        Args: { p_customer_code: string; p_phone: string; p_pin: string };
        Returns: Json;
      };
      get_customer_loyalty_portal: {
        Args: { p_token: string };
        Returns: Json;
      };
      request_customer_loyalty_reward: {
        Args: { p_token: string; p_reward: string };
        Returns: undefined;
      };
      customer_loyalty_logout: {
        Args: { p_token: string };
        Returns: undefined;
      };
      get_loyalty_admin_data: {
        Args: Record<string, never>;
        Returns: Json;
      };
      set_loyalty_earn_rate: {
        Args: { p_points_per_currency_unit: number };
        Returns: undefined;
      };
      save_loyalty_reward: {
        Args: {
          p_id: string | null;
          p_name_en: string;
          p_name_ar: string;
          p_description_en: string;
          p_description_ar: string;
          p_points_cost: number;
          p_stock_remaining: number | null;
          p_is_active: boolean;
          p_sort_order: number;
        };
        Returns: string;
      };
      delete_loyalty_reward: {
        Args: { p_reward: string };
        Returns: undefined;
      };
      adjust_customer_loyalty_points: {
        Args: { p_customer_code: string; p_points: number; p_reason: string };
        Returns: number;
      };
      resolve_loyalty_redemption: {
        Args: { p_redemption: string; p_status: string; p_reason?: string | null };
        Returns: undefined;
      };
      list_receipts_browser: {
        Args: {
          p_search: string | null;
          p_from: string | null;
          p_to: string | null;
          p_method: string | null;
          p_status: string | null;
          p_min_amount: number | null;
          p_max_amount: number | null;
          p_sort: string;
          p_direction: string;
          p_offset: number;
          p_limit: number;
        };
        Returns: Json;
      };
      get_receipt_browser_detail: {
        Args: { p_receipt: string };
        Returns: Json;
      };
      void_receipt: {
        Args: { p_receipt: string; p_reason: string };
        Returns: undefined;
      };
    };
    Enums: {
      account_status: "pending" | "active" | "rejected" | "suspended";
      customer_status: "active" | "blocked" | "expired";
    };
    CompositeTypes: Record<string, never>;
  };
};

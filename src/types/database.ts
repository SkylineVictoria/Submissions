export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: {
      forms: {
        Row: {
          id: number;
          name: string;
          version: string | null;
          status: string;
          active: boolean;
          unit_code: string | null;
          unit_name: string | null;
          qualification_code: string | null;
          qualification_name: string | null;
          header_asset_url: string | null;
          cover_asset_url: string | null;
          start_date: string | null;
          end_date: string | null;
          created_at: string;
        };
        Insert: {
          id?: number;
          name: string;
          version?: string | null;
          status?: string;
          active?: boolean;
          unit_code?: string | null;
          unit_name?: string | null;
          qualification_code?: string | null;
          qualification_name?: string | null;
          header_asset_url?: string | null;
          cover_asset_url?: string | null;
          start_date?: string | null;
          end_date?: string | null;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['forms']['Insert']>;
      };
      form_steps: {
        Row: {
          id: number;
          form_id: number;
          title: string;
          subtitle: string | null;
          sort_order: number;
        };
        Insert: {
          id?: number;
          form_id: number;
          title: string;
          subtitle?: string | null;
          sort_order?: number;
        };
        Update: Partial<Database['public']['Tables']['form_steps']['Insert']>;
      };
      form_sections: {
        Row: {
          id: number;
          step_id: number;
          title: string;
          description: string | null;
          pdf_render_mode: string;
          sort_order: number;
          assessment_task_row_id: number | null;
        };
        Insert: {
          id?: number;
          step_id: number;
          title: string;
          description?: string | null;
          pdf_render_mode?: string;
          sort_order?: number;
          assessment_task_row_id?: number | null;
        };
        Update: Partial<Database['public']['Tables']['form_sections']['Insert']>;
      };
      form_questions: {
        Row: {
          id: number;
          section_id: number;
          type: string;
          code: string | null;
          label: string;
          help_text: string | null;
          required: boolean;
          sort_order: number;
          role_visibility: Json;
          role_editability: Json;
          pdf_meta: Json;
        };
        Insert: {
          id?: number;
          section_id: number;
          type: string;
          code?: string | null;
          label: string;
          help_text?: string | null;
          required?: boolean;
          sort_order?: number;
          role_visibility?: Json;
          role_editability?: Json;
          pdf_meta?: Json;
        };
        Update: Partial<Database['public']['Tables']['form_questions']['Insert']>;
      };
      form_question_options: {
        Row: {
          id: number;
          question_id: number;
          value: string;
          label: string;
          sort_order: number;
        };
        Insert: {
          id?: number;
          question_id: number;
          value: string;
          label: string;
          sort_order?: number;
        };
        Update: Partial<Database['public']['Tables']['form_question_options']['Insert']>;
      };
      form_question_rows: {
        Row: {
          id: number;
          question_id: number;
          row_label: string;
          row_help: string | null;
          row_image_url: string | null;
          row_meta: Json | null;
          sort_order: number;
        };
        Insert: {
          id?: number;
          question_id: number;
          row_label: string;
          row_help?: string | null;
          row_image_url?: string | null;
          row_meta?: Json | null;
          sort_order?: number;
        };
        Update: Partial<Database['public']['Tables']['form_question_rows']['Insert']>;
      };
      form_instances: {
        Row: {
          id: number;
          form_id: number;
          status: string;
          role_context: string;
          created_at: string;
          submitted_at: string | null;
          submission_count: number;
        };
        Insert: {
          id?: number;
          form_id: number;
          status?: string;
          role_context?: string;
          created_at?: string;
          submitted_at?: string | null;
          submission_count?: number;
        };
        Update: Partial<Database['public']['Tables']['form_instances']['Insert']>;
      };
      form_answers: {
        Row: {
          id: number;
          instance_id: number;
          question_id: number;
          row_id: number | null;
          value_text: string | null;
          value_number: number | null;
          value_json: Json | null;
          updated_at: string;
        };
        Insert: {
          id?: number;
          instance_id: number;
          question_id: number;
          row_id?: number | null;
          value_text?: string | null;
          value_number?: number | null;
          value_json?: Json | null;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['form_answers']['Insert']>;
      };
      form_assets: {
        Row: {
          id: number;
          form_id: number;
          type: string | null;
          file_url: string;
          meta: Json;
          created_at: string;
        };
        Insert: {
          id?: number;
          form_id: number;
          type?: string | null;
          file_url: string;
          meta?: Json;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['form_assets']['Insert']>;
      };
    };
  };
}

export type Form = Database['public']['Tables']['forms']['Row'];
export type FormStep = Database['public']['Tables']['form_steps']['Row'];
export type FormSection = Database['public']['Tables']['form_sections']['Row'];
export type FormQuestion = Database['public']['Tables']['form_questions']['Row'];
export type FormQuestionOption = Database['public']['Tables']['form_question_options']['Row'];
export type FormQuestionRow = Database['public']['Tables']['form_question_rows']['Row'];
export type FormInstance = Database['public']['Tables']['form_instances']['Row'];
export type FormAnswer = Database['public']['Tables']['form_answers']['Row'];

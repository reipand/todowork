/**
 * Database types.
 *
 * Hand-written to mirror `supabase/migrations/` exactly, because a static-export project has
 * no server to generate them from. When you change the schema, regenerate with:
 *
 *   npx supabase gen types typescript --project-id YOUR_REF --schema public > src/types/database.ts
 *
 * then re-apply any manual adjustments noted below. Keeping this in sync matters: it is what
 * makes the typed client catch a wrong column name at compile time rather than at runtime.
 *
 * Regeneration caveat: the generator emits enums as string unions and our `task_priority`
 * enum relies on that. The `revision` column is `integer` in SQL and is typed `number` here.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type TaskPriorityEnum = 'low' | 'medium' | 'high';

/**
 * A foreign-key relationship, as postgrest-js requires it for embedded selects.
 *
 * The generated Supabase types include one entry per foreign key. postgrest-js uses this array to
 * resolve embedded resources AND as part of the `GenericTable` constraint: a table without a
 * `Relationships` key does not satisfy the constraint, and every query against it silently resolves
 * to `never`. That failure mode is why these are spelled out rather than omitted.
 */
export interface DbRelationship {
  foreignKeyName: string;
  columns: string[];
  isOneToOne?: boolean;
  referencedRelation: string;
  referencedColumns: string[];
}

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          display_name: string | null;
          avatar_url: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          display_name?: string | null;
          avatar_url?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          display_name?: string | null;
          avatar_url?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            // profiles.id references auth.users.id. Declared so an embed of the auth schema is a
            // compile error rather than a silent fetch.
            foreignKeyName: 'profiles_id_fkey';
            columns: ['id'];
            isOneToOne: true;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };

      projects: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          description: string | null;
          color: string;
          archived_at: string | null;
          deleted_at: string | null;
          created_at: string;
          updated_at: string;
          revision: number;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          description?: string | null;
          color?: string;
          archived_at?: string | null;
          deleted_at?: string | null;
          created_at?: string;
          updated_at?: string;
          revision?: number;
        };
        Update: {
          name?: string;
          description?: string | null;
          color?: string;
          archived_at?: string | null;
          deleted_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'projects_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };

      tasks: {
        Row: {
          id: string;
          user_id: string;
          project_id: string | null;
          title: string;
          description: string | null;
          completed: boolean;
          priority: TaskPriorityEnum;
          due_date: string | null;
          start_date: string | null;
          completed_at: string | null;
          reminder_at: string | null;
          deleted_at: string | null;
          created_at: string;
          updated_at: string;
          revision: number;
        };
        Insert: {
          id?: string;
          user_id: string;
          project_id?: string | null;
          title: string;
          description?: string | null;
          completed?: boolean;
          priority?: TaskPriorityEnum;
          due_date?: string | null;
          start_date?: string | null;
          completed_at?: string | null;
          reminder_at?: string | null;
          deleted_at?: string | null;
          created_at?: string;
          updated_at?: string;
          revision?: number;
        };
        Update: {
          project_id?: string | null;
          title?: string;
          description?: string | null;
          completed?: boolean;
          priority?: TaskPriorityEnum;
          due_date?: string | null;
          start_date?: string | null;
          completed_at?: string | null;
          reminder_at?: string | null;
          deleted_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'tasks_project_id_fkey';
            columns: ['project_id'];
            isOneToOne: false;
            referencedRelation: 'projects';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'tasks_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };

      tags: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          color: string;
          deleted_at: string | null;
          created_at: string;
          updated_at: string;
          revision: number;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          color?: string;
          deleted_at?: string | null;
          created_at?: string;
          updated_at?: string;
          revision?: number;
        };
        Update: {
          name?: string;
          color?: string;
          deleted_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'tags_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };

      task_tags: {
        Row: {
          id: string;
          task_id: string;
          tag_id: string;
          user_id: string;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
          revision: number;
        };
        Insert: {
          id?: string;
          task_id: string;
          tag_id: string;
          user_id: string;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          revision?: number;
        };
        Update: {
          deleted_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'task_tags_task_id_fkey';
            columns: ['task_id'];
            isOneToOne: false;
            referencedRelation: 'tasks';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'task_tags_tag_id_fkey';
            columns: ['tag_id'];
            isOneToOne: false;
            referencedRelation: 'tags';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'task_tags_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };

      task_subtasks: {
        Row: {
          id: string;
          task_id: string;
          user_id: string;
          title: string;
          completed: boolean;
          position: number;
          deleted_at: string | null;
          created_at: string;
          updated_at: string;
          revision: number;
        };
        Insert: {
          id?: string;
          task_id: string;
          user_id: string;
          title: string;
          completed?: boolean;
          position?: number;
          deleted_at?: string | null;
          created_at?: string;
          updated_at?: string;
          revision?: number;
        };
        Update: {
          title?: string;
          completed?: boolean;
          position?: number;
          deleted_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'task_subtasks_task_id_fkey';
            columns: ['task_id'];
            isOneToOne: false;
            referencedRelation: 'tasks';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'task_subtasks_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };

      sync_mutations: {
        Row: {
          id: string;
          user_id: string;
          idempotency_key: string;
          entity_type: string;
          entity_id: string;
          operation: string;
          result_revision: number | null;
          applied_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          idempotency_key: string;
          entity_type: string;
          entity_id: string;
          operation: string;
          result_revision?: number | null;
          applied_at?: string;
        };
        /**
         * Only `result_revision` is ever updated: the ledger records which server revision a
         * mutation produced once it succeeds. The other columns are immutable, and the SQL grants
         * no UPDATE policy on them.
         */
        Update: {
          result_revision?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: 'sync_mutations_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };

      sync_conflicts: {
        Row: {
          id: string;
          user_id: string;
          entity_type: string;
          entity_id: string;
          conflicting_fields: string;
          local_payload: Json;
          remote_payload: Json;
          server_revision: number;
          detected_at: string;
          resolved_at: string | null;
          resolution: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          entity_type: string;
          entity_id: string;
          conflicting_fields: string;
          local_payload: Json;
          remote_payload: Json;
          server_revision: number;
          detected_at?: string;
          resolved_at?: string | null;
          resolution?: string | null;
        };
        Update: {
          resolved_at?: string | null;
          resolution?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'sync_conflicts_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };

      sync_devices: {
        Row: {
          id: string;
          user_id: string;
          device_id: string;
          device_label: string | null;
          platform: string | null;
          last_pulled_revision: number;
          last_push_at: string | null;
          last_pull_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          device_id: string;
          device_label?: string | null;
          platform?: string | null;
          last_pulled_revision?: number;
          last_push_at?: string | null;
          last_pull_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          device_label?: string | null;
          platform?: string | null;
          last_pulled_revision?: number;
          last_push_at?: string | null;
          last_pull_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: 'sync_devices_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
    };

    Views: Record<string, never>;

    Functions: {
      check_revision: {
        Args: { p_table: string; p_id: string; p_base_revision: number };
        Returns: boolean;
      };
      purge_expired_tombstones: {
        Args: { p_retention_days?: number };
        Returns: Array<{
          purged_tasks: number;
          purged_projects: number;
          purged_tags: number;
          purged_subtasks: number;
        }>;
      };
      purge_stale_idempotency_records: {
        Args: { p_retention_days?: number };
        Returns: number;
      };
      purge_resolved_conflicts: {
        Args: { p_retention_days?: number };
        Returns: number;
      };
    };

    Enums: {
      task_priority: TaskPriorityEnum;
    };

    CompositeTypes: Record<string, never>;
  };
}

/** Convenience aliases so call sites do not repeat the indexing path. */
export type TaskRow = Database['public']['Tables']['tasks']['Row'];
export type TaskInsert = Database['public']['Tables']['tasks']['Insert'];
export type TaskUpdate = Database['public']['Tables']['tasks']['Update'];

export type ProjectRow = Database['public']['Tables']['projects']['Row'];
export type ProjectInsert = Database['public']['Tables']['projects']['Insert'];

export type TagRow = Database['public']['Tables']['tags']['Row'];
export type TagInsert = Database['public']['Tables']['tags']['Insert'];

export type SubtaskRow = Database['public']['Tables']['task_subtasks']['Row'];
export type SubtaskInsert = Database['public']['Tables']['task_subtasks']['Insert'];

export type TaskTagRow = Database['public']['Tables']['task_tags']['Row'];
export type ProfileRow = Database['public']['Tables']['profiles']['Row'];

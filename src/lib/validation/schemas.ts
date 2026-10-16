import { z } from 'zod';

/**
 * Validation schemas.
 *
 * These run at the service layer, which is the last point where input is still trusted code.
 * They are the client half of a two-layer check: the SQL migrations carry matching CHECK
 * constraints, and those are the ones that actually enforce. Client validation exists to give
 * a good error message before a network round-trip, not to provide security. See
 * docs/SECURITY.md.
 *
 * Limits match the CHECK constraints in migration 0001 exactly. If they drift, the user sees
 * a friendly error locally and a raw database error on sync, so keep them in step.
 */

/** Calendar date as `YYYY-MM-DD`. Rejects instants, which would reintroduce timezone drift. */
export const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
  .refine(
    (value) => {
      // Reject impossible dates like 2026-02-31, which the regex alone would accept.
      const [year, month, day] = value.split('-').map(Number);
      if (year === undefined || month === undefined || day === undefined) return false;
      const date = new Date(Date.UTC(year, month - 1, day));
      return (
        date.getUTCFullYear() === year &&
        date.getUTCMonth() === month - 1 &&
        date.getUTCDate() === day
      );
    },
    { message: 'Date does not exist on the calendar' },
  );

export const prioritySchema = z.enum(['low', 'medium', 'high']);

export const taskTitleSchema = z
  .string()
  .trim()
  .min(1, 'Title is required')
  .max(500, 'Title must be 500 characters or fewer');

export const taskDescriptionSchema = z
  .string()
  .max(10000, 'Description must be 10,000 characters or fewer')
  .nullable();

export const projectNameSchema = z
  .string()
  .trim()
  .min(1, 'Project name is required')
  .max(120, 'Project name must be 120 characters or fewer');

export const projectDescriptionSchema = z
  .string()
  .max(2000, 'Project description must be 2,000 characters or fewer')
  .nullable();

export const tagNameSchema = z
  .string()
  .trim()
  .min(1, 'Tag name is required')
  .max(48, 'Tag name must be 48 characters or fewer');

export const subtaskTitleSchema = z
  .string()
  .trim()
  .min(1, 'Checklist item text is required')
  .max(500, 'Checklist item text must be 500 characters or fewer');

/**
 * Hex colour, constrained to 6 digits.
 *
 * Constrained rather than free-form because this value is written into a CSS custom property
 * for the "work rail" motif. Accepting arbitrary text there would be a style-injection vector,
 * so the validation and the database CHECK agree.
 */
export const hexColorSchema = z
  .string()
  .regex(/^#[0-9A-Fa-f]{6}$/, 'Colour must be a 6-digit hex value like #4F46E5');

/**
 * The project colour palette.
 *
 * A fixed set rather than a colour picker: project colours encode membership in the rail
 * motif, so they must stay distinguishable from each other and legible in both themes. A free
 * picker would let a user choose a near-white colour that disappears on the light surface.
 * The palette is ordered so adjacent projects are never similar hues.
 */
export const PROJECT_COLORS = [
  '#4F46E5', // Iris, the product accent
  '#0F766E', // Teal
  '#B45309', // Amber
  '#BE123C', // Rose
  '#4338CA', // Indigo
  '#15803D', // Green
  '#0E7490', // Cyan
  '#7C2D12', // Rust
  '#6D28D9', // Violet
  '#374151', // Slate, for "no particular project"
] as const;

export type ProjectColor = (typeof PROJECT_COLORS)[number];

export const projectColorSchema = hexColorSchema;

/**
 * Task creation input.
 *
 * `due_date` may be null (no deadline). `start_date` is validated against `due_date` in the
 * object-level refinement below, matching the SQL CHECK so the user gets the error locally.
 */
export const createTaskInputSchema = z
  .object({
    title: taskTitleSchema,
    description: taskDescriptionSchema.optional().default(null),
    project_id: z.string().uuid('Project must be a valid id').nullable().optional().default(null),
    priority: prioritySchema.default('medium'),
    due_date: calendarDateSchema.nullable().optional().default(null),
    start_date: calendarDateSchema.nullable().optional().default(null),
    reminder_at: z.string().datetime({ offset: true }).nullable().optional().default(null),
    tag_ids: z.array(z.string().uuid()).max(20, 'A task may have at most 20 tags').optional().default([]),
  })
  .refine(
    (data) =>
      data.start_date === null || data.due_date === null || data.start_date <= data.due_date,
    { message: 'Start date cannot be after the due date', path: ['start_date'] },
  );

export type CreateTaskInput = z.infer<typeof createTaskInputSchema>;

/**
 * Task update input.
 *
 * Every field is optional: this is a partial patch, and the service layer merges it onto the
 * existing row. The start/due cross-check is intentionally absent here because validation of a
 * partial patch requires the merged row, which the service performs after merging. Documented
 * so the missing refinement is not mistaken for an oversight.
 */
export const updateTaskInputSchema = z.object({
  title: taskTitleSchema.optional(),
  description: taskDescriptionSchema.optional(),
  project_id: z.string().uuid().nullable().optional(),
  completed: z.boolean().optional(),
  priority: prioritySchema.optional(),
  due_date: calendarDateSchema.nullable().optional(),
  start_date: calendarDateSchema.nullable().optional(),
  reminder_at: z.string().datetime({ offset: true }).nullable().optional(),
  tag_ids: z.array(z.string().uuid()).max(20).optional(),
});

export type UpdateTaskInput = z.infer<typeof updateTaskInputSchema>;

export const createProjectInputSchema = z.object({
  name: projectNameSchema,
  description: projectDescriptionSchema.optional().default(null),
  color: projectColorSchema.default('#4F46E5'),
});

export type CreateProjectInput = z.infer<typeof createProjectInputSchema>;

export const updateProjectInputSchema = z.object({
  name: projectNameSchema.optional(),
  description: projectDescriptionSchema.optional(),
  color: projectColorSchema.optional(),
  archived: z.boolean().optional(),
});

export type UpdateProjectInput = z.infer<typeof updateProjectInputSchema>;

export const createTagInputSchema = z.object({
  name: tagNameSchema,
  color: projectColorSchema.default('#55708A'),
});

export type CreateTagInput = z.infer<typeof createTagInputSchema>;

export const createSubtaskInputSchema = z.object({
  task_id: z.string().uuid(),
  title: subtaskTitleSchema,
});

export type CreateSubtaskInput = z.infer<typeof createSubtaskInputSchema>;

export const updateSubtaskInputSchema = z.object({
  title: subtaskTitleSchema.optional(),
  completed: z.boolean().optional(),
  position: z.number().finite().optional(),
});

export type UpdateSubtaskInput = z.infer<typeof updateSubtaskInputSchema>;

/**
 * Authentication schemas.
 *
 * The password minimum is 8 rather than the Supabase default of 6. This is a client-side
 * convenience only: the authoritative minimum is whatever your Supabase project sets under
 * Authentication -> Policies. Keep them aligned, or a user passes locally and is rejected by
 * the server with a less clear message. See docs/SECURITY.md.
 */
export const emailSchema = z
  .string()
  .trim()
  .min(1, 'Email is required')
  .email('Enter a valid email address')
  .max(254, 'Email is too long');

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password must be 72 characters or fewer'); // bcrypt truncates beyond 72 bytes.

export const signUpSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export type SignUpInput = z.infer<typeof signUpSchema>;

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required'),
});

export type SignInInput = z.infer<typeof signInSchema>;

export const resetPasswordRequestSchema = z.object({
  email: emailSchema,
});

export type ResetPasswordRequestInput = z.infer<typeof resetPasswordRequestSchema>;

export const resetPasswordSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const profileUpdateSchema = z.object({
  display_name: z
    .string()
    .trim()
    .max(80, 'Display name must be 80 characters or fewer')
    .nullable(),
});

export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;

/**
 * Formats a Zod error into a `field -> message` map for form display.
 *
 * Produces a stable shape so every form announces errors identically, which the accessibility
 * requirements depend on (error text must be linked to its field via aria-describedby).
 */
export function formatZodErrors(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_form';
    // Keep the first message per field: showing a stack of errors for one input is worse UX
    // than showing the most relevant one.
    if (!result[key]) {
      result[key] = issue.message;
    }
  }
  return result;
}

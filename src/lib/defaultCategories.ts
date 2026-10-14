import type { CategoryInput } from './types'

const expense = (name: string, icon: CategoryInput['icon'], color: CategoryInput['color'], order: number): CategoryInput =>
  ({ name, icon, color, kind: 'expense', order, archived: false })
const income = (name: string, icon: CategoryInput['icon'], color: CategoryInput['color'], order: number): CategoryInput =>
  ({ name, icon, color, kind: 'income', order, archived: false })

export const DEFAULT_CATEGORIES: CategoryInput[] = [
  expense('Groceries', 'ShoppingCart', 'emerald', 0),
  expense('Eating out', 'Utensils', 'orange', 1),
  expense('Coffee', 'Coffee', 'amber', 2),
  expense('Transport', 'Bus', 'sky', 3),
  expense('Taxi', 'Car', 'yellow', 4),
  expense('Housing', 'House', 'indigo', 5),
  expense('Utilities', 'Zap', 'violet', 6),
  expense('Phone & Internet', 'Wifi', 'cyan', 7),
  expense('Health', 'HeartPulse', 'rose', 8),
  expense('Sport', 'Dumbbell', 'lime', 9),
  expense('Clothes', 'Shirt', 'pink', 10),
  expense('Entertainment', 'Clapperboard', 'fuchsia', 11),
  expense('Subscriptions', 'Tv', 'blue', 12),
  expense('Travel', 'Plane', 'teal', 13),
  expense('Gifts', 'Gift', 'red', 14),
  expense('Education', 'GraduationCap', 'green', 15),
  expense('Beauty', 'Sparkles', 'violet', 16),
  expense('Pets', 'PawPrint', 'amber', 17),
  expense('Other', 'CircleEllipsis', 'slate', 18),
  income('Salary', 'Banknote', 'emerald', 0),
  income('Freelance', 'Laptop', 'cyan', 1),
  income('Gift', 'Gift', 'pink', 2),
  income('Investments', 'TrendingUp', 'lime', 3),
  income('Refund', 'Undo2', 'sky', 4),
  income('Other', 'CircleEllipsis', 'slate', 5),
]

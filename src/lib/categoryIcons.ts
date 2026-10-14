import {
  Apple, Baby, Backpack, Banknote, Beer, Bike, Book, Briefcase, Bus, Cake, Camera, Car, Cat,
  CircleEllipsis, Clapperboard, Coffee, CreditCard, Dog, Droplets, Dumbbell, FileText, Flower2,
  Fuel, Gamepad2, Gem, Gift, Glasses, Globe, GraduationCap, HandCoins, Headphones, HeartHandshake,
  HeartPulse, Hotel, House, Landmark, Laptop, Lightbulb, Monitor, Music, Palette, PawPrint,
  PiggyBank, Pill, Pizza, Plane, Receipt, Salad, Scissors, Shield, Shirt, ShoppingBag,
  ShoppingCart, Smartphone, Sofa, Sparkles, Stethoscope, Tent, Ticket, TrainFront, TrendingUp,
  Tv, Umbrella, Undo2, Users, Utensils, Watch, Wifi, Wine, Wrench, Zap,
  type LucideIcon,
} from 'lucide-react'

export const CATEGORY_ICONS = {
  Apple, Baby, Backpack, Banknote, Beer, Bike, Book, Briefcase, Bus, Cake, Camera, Car, Cat,
  CircleEllipsis, Clapperboard, Coffee, CreditCard, Dog, Droplets, Dumbbell, FileText, Flower2,
  Fuel, Gamepad2, Gem, Gift, Glasses, Globe, GraduationCap, HandCoins, Headphones, HeartHandshake,
  HeartPulse, Hotel, House, Landmark, Laptop, Lightbulb, Monitor, Music, Palette, PawPrint,
  PiggyBank, Pill, Pizza, Plane, Receipt, Salad, Scissors, Shield, Shirt, ShoppingBag,
  ShoppingCart, Smartphone, Sofa, Sparkles, Stethoscope, Tent, Ticket, TrainFront, TrendingUp,
  Tv, Umbrella, Undo2, Users, Utensils, Watch, Wifi, Wine, Wrench, Zap,
} satisfies Record<string, LucideIcon>

export type IconKey = keyof typeof CATEGORY_ICONS
export const ICON_KEYS = Object.keys(CATEGORY_ICONS) as IconKey[]
export const FALLBACK_ICON: IconKey = 'CircleEllipsis'

export function isIconKey(v: unknown): v is IconKey {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(CATEGORY_ICONS, v)
}

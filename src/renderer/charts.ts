import { useApp } from './store';

/**
 * Categorical data-viz slots (validated reference palette), assigned in fixed order and never
 * cycled: anything past slot 8 folds into the neutral "Other". Concrete hex values are used
 * because SVG presentation attributes do not resolve CSS variables.
 */
const DARK = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#0ca30c', '#9085e9', '#e66767'];
const LIGHT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];

export function usePalette() {
  const light = useApp((s) => s.settings?.theme === 'light');
  const series = light ? LIGHT : DARK;
  return {
    series,
    other: light ? '#b4b2bd' : '#5c5b66',
    used: series[6],
    surface: light ? '#ffffff' : '#111117',
    color: (i: number) => (i < series.length ? series[i] : light ? '#b4b2bd' : '#5c5b66'),
  };
}

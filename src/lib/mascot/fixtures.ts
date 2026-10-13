// Fixture mascot concepts for AI_MODE=fixture (dev and tests): three sweet-shop
// characters with valid specs. Used by generateJson when no live model is called.

import type { MascotConcepts, MascotSpec } from '@/lib/ai/schemas';

export const FIXTURE_SPECS: MascotSpec[] = [
  {
    body: { shape: 'round', color: '#F2A93B', pattern: 'dots', pattern_color: '#FFD98A' },
    face: { eyes: 'shine', brows: true, cheeks: true, mustache: 'none' },
    limbs: { style: 'mitten', color: '#6B3A1C' },
    head: 'chef_hat',
    neck: 'none',
    extra: 'none',
    accent_color: '#B5121B',
  },
  {
    body: { shape: 'bean', color: '#F7931E', pattern: 'swirl', pattern_color: '#FFC266' },
    face: { eyes: 'round', brows: true, cheeks: true, mustache: 'none' },
    limbs: { style: 'noodle', color: '#7A3E0B' },
    head: 'headband',
    neck: 'none',
    extra: 'specs',
    accent_color: '#1B998B',
  },
  {
    body: { shape: 'box', color: '#C8283A', pattern: 'stripes', pattern_color: '#E5586A' },
    face: { eyes: 'dot', brows: true, cheeks: false, mustache: 'thin' },
    limbs: { style: 'stick', color: '#3A2A1A' },
    head: 'cap',
    neck: 'apron',
    extra: 'apron_pocket',
    accent_color: '#F2B100',
  },
];

export const FIXTURE_CONCEPTS: MascotConcepts = {
  refused: false,
  refusal_reason: '',
  concepts: [
    {
      name: 'Laddu',
      name_local: 'लड्डू',
      personality: 'Round, warm and always ready to share a sweet.',
      why_it_fits: 'A laddoo is the first thing people think of at a mithai shop.',
      spec: FIXTURE_SPECS[0],
    },
    {
      name: 'Jalebi',
      name_local: 'जलेबी',
      personality: 'Curly, cheerful and a little bit clever.',
      why_it_fits: 'Hot jalebi is a favourite morning treat for your customers.',
      spec: FIXTURE_SPECS[1],
    },
    {
      name: 'Mithu',
      name_local: 'मिठू',
      personality: 'A neat little shopkeeper with a big smile.',
      why_it_fits: 'Looks like a gift box, so it suits festival orders.',
      spec: FIXTURE_SPECS[2],
    },
  ],
};

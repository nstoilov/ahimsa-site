import {defineConfig} from 'sanity'
import {structureTool} from 'sanity/structure'
import {visionTool} from '@sanity/vision'
import {schemaTypes} from './schemas'
import {structure} from './structure'

export default defineConfig({
  name: 'ahimsa-blog',
  title: 'Ahimsa Blog',
  projectId: process.env.SANITY_STUDIO_PROJECT_ID || 'cqeu4nnj',
  dataset: process.env.SANITY_STUDIO_DATASET || 'production',
  plugins: [structureTool({structure}), visionTool()],
  schema: {types: schemaTypes},
})

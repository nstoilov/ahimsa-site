import {defineField, defineType} from 'sanity'

export default defineType({
  name: 'category',
  title: 'Категория',
  type: 'document',
  fields: [
    defineField({
      name: 'title',
      title: 'Заглавие',
      type: 'string',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'description',
      title: 'Описание',
      type: 'text',
      rows: 2,
    }),
  ],
})

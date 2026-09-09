import {defineField, defineType} from 'sanity'

export default defineType({
  name: 'author',
  title: 'Автор',
  type: 'document',
  fields: [
    defineField({
      name: 'name',
      title: 'Име',
      type: 'string',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'picture',
      title: 'Снимка',
      type: 'image',
      options: {hotspot: true},
    }),
  ],
  preview: {
    select: {
      title: 'name',
      media: 'picture',
    },
  },
})

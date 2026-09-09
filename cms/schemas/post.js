import {defineField, defineType} from 'sanity'

export default defineType({
  name: 'post',
  title: 'Статия',
  type: 'document',
  orderings: [
    {
      title: 'Published, newest first',
      name: 'publishedAtDesc',
      by: [{field: 'publishedAt', direction: 'DESC'}],
    },
  ],
  fields: [
    defineField({
      name: 'title',
      title: 'Заглавие',
      type: 'string',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'slug',
      title: 'Slug (URL)',
      type: 'slug',
      options: {source: 'title', maxLength: 96},
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'excerpt',
      title: 'Кратко описание',
      type: 'text',
      rows: 3,
      description: 'Използва се в картата в списъка и като meta description (без SEO описание).',
      validation: (rule) => rule.required().max(300),
    }),
    defineField({
      name: 'coverImage',
      title: 'Корица',
      type: 'image',
      options: {hotspot: true},
      fields: [
        defineField({
          name: 'alt',
          title: 'Alt текст',
          type: 'string',
          validation: (rule) => rule.required(),
        }),
        defineField({
          name: 'caption',
          title: 'Подпис',
          type: 'string',
        }),
      ],
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'body',
      title: 'Съдържание',
      type: 'blockContent',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'publishedAt',
      title: 'Дата на публикуване',
      type: 'datetime',
      initialValue: () => new Date().toISOString(),
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'author',
      title: 'Автор',
      type: 'reference',
      to: [{type: 'author'}],
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'categories',
      title: 'Категории',
      type: 'array',
      of: [{type: 'reference', to: [{type: 'category'}]}],
    }),
    defineField({
      name: 'seoTitle',
      title: 'SEO заглавие (по избор)',
      type: 'string',
      description: 'Ако е празно, се използва „<заглавие> | Ahimsa".',
    }),
    defineField({
      name: 'seoDescription',
      title: 'SEO описание (по избор)',
      type: 'text',
      rows: 3,
      description: 'Ако е празно, се използва краткото описание.',
    }),
    defineField({
      name: 'canonicalUrl',
      title: 'Canonical URL (по избор)',
      type: 'url',
      description: 'Само ако статията е публикувана и другаде.',
    }),
  ],
  preview: {
    select: {
      title: 'title',
      subtitle: 'publishedAt',
      media: 'coverImage',
    },
  },
})

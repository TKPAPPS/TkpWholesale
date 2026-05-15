

const config = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.odoo.com',
        pathname: '/web/image/**',
      },
    ],
  },
}

export default config

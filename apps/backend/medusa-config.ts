import { loadEnv, defineConfig } from '@medusajs/framework/utils'

loadEnv(process.env.NODE_ENV || 'development', process.cwd())

module.exports = defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    http: {
      storeCors: process.env.STORE_CORS!,
      adminCors: process.env.ADMIN_CORS!,
      authCors: process.env.AUTH_CORS!,
      jwtSecret: process.env.JWT_SECRET,
      cookieSecret: process.env.COOKIE_SECRET,
    }
  },
  modules: [
    {
      // Provider id lưu trong DB là pp_{identifier}_{id} = pp_vnpay_vnpay.
      resolve: '@medusajs/medusa/payment',
      options: {
        providers: [
          {
            resolve: './src/modules/vnpay',
            id: 'vnpay',
            options: {
              tmnCode: process.env.VNPAY_TMN_CODE,
              hashSecret: process.env.VNPAY_HASH_SECRET,
              payUrl: process.env.VNPAY_PAY_URL || 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html',
              returnUrl: process.env.VNPAY_RETURN_URL || 'http://localhost:8000/vn/checkout/vnpay-return',
              ipAddr: process.env.VNPAY_IP_ADDR || undefined,
              apiUrl: process.env.VNPAY_API_URL || undefined,
            },
          },
        ],
      },
    },
  ],
})

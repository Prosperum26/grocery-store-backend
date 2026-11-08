import { Module } from "@medusajs/framework/utils"
import redisLoader from "./loaders/redis"
import HotStockModuleService from "./service"

export const HOT_STOCK_MODULE = "hotStock"

export default Module(HOT_STOCK_MODULE, {
  service: HotStockModuleService,
  loaders: [redisLoader],
})

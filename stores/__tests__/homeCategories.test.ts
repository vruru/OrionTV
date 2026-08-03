jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock")
);

import { initialCategories } from "../homeStore";

describe("首页分类", () => {
  it("应提供综艺的全部、国内和国外选项", () => {
    const variety = initialCategories.find((category) => category.title === "综艺");
    expect(variety?.tags?.map((tag) => tag.label)).toEqual(["全部", "国内", "国外"]);
    expect(variety?.tags?.map((tag) => tag.value)).toEqual(["show", "show_domestic", "show_foreign"]);
  });

  it("应提供卡通入口及网页端主要选项", () => {
    const anime = initialCategories.find((category) => category.title === "卡通");
    const labels = anime?.tags?.map((tag) => tag.label) ?? [];
    expect(labels).toEqual(
      expect.arrayContaining(["每日放送", "番剧", "剧场版", "国漫", "日本", "欧美", "韩国", "儿童", "治愈", "科幻", "魔幻", "运动"])
    );
  });

  it("卡通筛选应向推荐接口传网页端使用的中文标签", () => {
    const anime = initialCategories.find((category) => category.title === "卡通");
    const chineseAnime = anime?.tags?.find((tag) => tag.label === "国漫")?.query;
    const japanese = anime?.tags?.find((tag) => tag.label === "日本")?.query;
    expect(chineseAnime).toMatchObject({ mode: "recommends", label: "国漫" });
    expect(japanese).toMatchObject({ mode: "recommends", region: "日本" });
  });

  it("每个子选项都应带有可执行的数据请求", () => {
    for (const category of initialCategories) {
      for (const tag of category.tags ?? []) {
        expect(tag.value).toBeTruthy();
        expect(tag.query.mode).toBeTruthy();
      }
    }
  });
});

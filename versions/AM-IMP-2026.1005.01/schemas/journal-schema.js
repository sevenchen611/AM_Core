// Late-bound tenant-local IDs; this file contains no production bindings.
export function journalSchemas(ids) {
  const rich = () => ({ rich_text: {} });
  const number = () => ({ number: {} });
  const date = () => ({ date: {} });
  const relation = (key, twoWay = false) => {
    if (!ids[key]) throw new Error(`Missing tenant-local binding: ${key}`);
    return { relation: { data_source_id: ids[key], type: twoWay ? 'dual_property' : 'single_property', ...(twoWay ? { dual_property: {} } : { single_property: {} }) } };
  };
  const optional = (key, twoWay = false) => ids[key] ? relation(key, twoWay) : null;
  const progress = {
    '施工紀錄': { title: {} }, '專案': relation('projects'), '日誌': optional('constructionJournals', true), '工項': relation('workItems', true),
    '空間': relation('spaces', true),
    '預算項目': relation('budgets', true), '合約': relation('contracts', true), '施工日期': date(), '紀錄識別碼': rich(),
    '工班': rich(), '工種': rich(), '施工位置': rich(), '施工內容': rich(), '今日施作量': number(), '單位': rich(),
    '累計完成率': number(), '障礙': rich(), '下一步': rich(), '現場照片': optional('constructionPhotos'), '來源附件': relation('attachments'),
  };
  return {
    constructionJournals: { name: '工程日誌', properties: {
      '日誌': { title: {} }, '專案': relation('projects', true), '施工日期': date(),
      '狀態': { select: { options: ['整理中', '已更新', '待確認', '已確認', '作廢'].map(name => ({ name })) } },
      '進場人數': number(), '今日總結': rich(), '填報者': rich(), '提交識別碼': rich(), '內容雜湊': rich(),
      '原始回報': rich(), '確認者': rich(), '確認時間': date(), '確認說明': rich(),
      '更新時間': date(),
      '作廢者': rich(), '作廢時間': date(), '作廢原因': rich(),
    } },
    constructionPhotos: { name: '工程日誌現場照片', properties: {
      '照片': { title: {} }, '專案': relation('projects'), '施工日期': date(), 'Drive 連結': { url: {} },
      'Drive 檔案 ID': rich(), '說明': rich(), '上傳者': rich(), '檔案大小': number(),
    } },
    constructionProgress: { name: '工程施工進度紀錄', properties: progress },
  };
}
